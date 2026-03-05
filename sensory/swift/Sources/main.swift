// oneiro-sensory — OCA Sensory Cortex (Swift)
// Real-time HID monitoring, screen capture, audio tap, system events
// Outputs structured JSON events to stdout (consumed by Node.js cognitive loop)

import Cocoa
import CoreGraphics
import ScreenCaptureKit
import AVFoundation
import IOKit
import IOKit.ps

// MARK: - Configuration

let SCREEN_CAPTURE_INTERVAL: TimeInterval = 2.0  // seconds between captures (active)
let IDLE_CAPTURE_INTERVAL: TimeInterval = 10.0     // seconds between captures (idle)
let HID_METRICS_INTERVAL: TimeInterval = 5.0       // seconds between HID metric reports
let INTERO_INTERVAL: TimeInterval = 10.0            // seconds between interoceptive reports
let IDLE_THRESHOLD: TimeInterval = 30.0             // seconds before "idle"
let SCREENSHOT_MIN_COOLDOWN: TimeInterval = 10.0
let SCREENSHOT_PERIODIC_INTERVAL: TimeInterval = 45.0

// MARK: - Event Output

func emitEvent(_ type: String, _ payload: [String: Any]) {
    let event: [String: Any] = [
        "type": type,
        "timestamp": ISO8601DateFormatter().string(from: Date()),
        "payload": payload
    ]
    if let data = try? JSONSerialization.data(withJSONObject: event),
       let str = String(data: data, encoding: .utf8) {
        print(str)
        fflush(stdout)
    }
}

// MARK: - HID Event Monitoring

class HIDMonitor {
    var keyDownCount = 0
    var keyUpCount = 0
    var backspaceCount = 0
    var mouseClickCount = 0
    var mouseMoveDistance: Double = 0
    var lastMousePosition = CGPoint.zero
    var lastKeyTime: Date?
    var interKeyIntervals: [TimeInterval] = []
    var lastReportTime = Date()
    
    var eventTap: CFMachPort?
    
    func start() {
        let eventMask: CGEventMask = (1 << CGEventType.keyDown.rawValue) |
                                     (1 << CGEventType.keyUp.rawValue) |
                                     (1 << CGEventType.leftMouseDown.rawValue) |
                                     (1 << CGEventType.rightMouseDown.rawValue) |
                                     (1 << CGEventType.mouseMoved.rawValue) |
                                     (1 << CGEventType.flagsChanged.rawValue) |
                                     (1 << CGEventType.scrollWheel.rawValue)
        
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: eventMask,
            callback: { (proxy, type, event, refcon) -> Unmanaged<CGEvent>? in
                let monitor = Unmanaged<HIDMonitor>.fromOpaque(refcon!).takeUnretainedValue()
                monitor.handleEvent(type: type, event: event)
                return Unmanaged.passRetained(event)
            },
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else {
            emitEvent("error", ["message": "Failed to create event tap. Grant Input Monitoring permission in System Settings."])
            return
        }
        
        eventTap = tap
        let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        
        emitEvent("system", ["message": "HID monitoring started"])
        
        // Periodic metric reporting
        Timer.scheduledTimer(withTimeInterval: HID_METRICS_INTERVAL, repeats: true) { [weak self] _ in
            self?.reportMetrics()
        }
    }
    
    func handleEvent(type: CGEventType, event: CGEvent) {
        let now = Date()
        
        switch type {
        case .keyDown:
            keyDownCount += 1
            let keycode = event.getIntegerValueField(.keyboardEventKeycode)
            if keycode == 51 { backspaceCount += 1 } // delete key
            
            if let last = lastKeyTime {
                let interval = now.timeIntervalSince(last)
                if interval < 2.0 { // ignore long pauses
                    interKeyIntervals.append(interval)
                    if interKeyIntervals.count > 100 { interKeyIntervals.removeFirst() }
                }
            }
            lastKeyTime = now
            
        case .keyUp:
            keyUpCount += 1
            
        case .leftMouseDown, .rightMouseDown:
            mouseClickCount += 1
            
        case .mouseMoved:
            let pos = event.location
            let dx = pos.x - lastMousePosition.x
            let dy = pos.y - lastMousePosition.y
            mouseMoveDistance += sqrt(dx*dx + dy*dy)
            lastMousePosition = pos
            
        default:
            break
        }
    }
    
    func reportMetrics() {
        let elapsed = Date().timeIntervalSince(lastReportTime)
        guard elapsed > 1 else { return }
        
        // Compute WPM (rough: 5 chars per word)
        let wpm = (Double(keyDownCount) / 5.0) / (elapsed / 60.0)
        
        // Error rate (backspace ratio)
        let errorRate = keyDownCount > 0 ? Double(backspaceCount) / Double(keyDownCount) : 0
        
        // Average inter-key interval
        let avgIKI = interKeyIntervals.isEmpty ? 0 : interKeyIntervals.reduce(0, +) / Double(interKeyIntervals.count)
        
        // Typing speed classification
        let speedClass: String
        if wpm > 60 { speedClass = "fast" }
        else if wpm > 30 { speedClass = "moderate" }
        else if wpm > 5 { speedClass = "slow" }
        else { speedClass = "idle" }
        
        emitEvent("hid_metrics", [
            "keystrokes": keyDownCount,
            "backspaces": backspaceCount,
            "clicks": mouseClickCount,
            "mouse_distance": Int(mouseMoveDistance),
            "wpm": round(wpm * 10) / 10,
            "error_rate": round(errorRate * 1000) / 1000,
            "avg_iki_ms": round(avgIKI * 1000),
            "speed_class": speedClass,
            "elapsed_seconds": round(elapsed)
        ])
        
        // Reset counters
        keyDownCount = 0
        keyUpCount = 0
        backspaceCount = 0
        mouseClickCount = 0
        mouseMoveDistance = 0
        interKeyIntervals = []
        lastReportTime = Date()
    }
}

// MARK: - Screenshot Capture

class ScreenshotCaptor {
    private var lastCapturedApp = ""
    private var lastCapturedTitle = ""
    private var lastCaptureTime = Date.distantPast
    private var isCapturing = false
    private var permissionErrorLogged = false

    private let screenshotsDir = URL(fileURLWithPath: "/Users/quinnodonnell/.openclaw/workspace/oneiro-core/screenshots", isDirectory: true)
    private let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone.current
        f.dateFormat = "yyyy-MM-dd_HH-mm-ss"
        return f
    }()

    func start() {
        ensureDir()

        Timer.scheduledTimer(withTimeInterval: SCREENSHOT_PERIODIC_INTERVAL, repeats: true) { [weak self] _ in
            guard let self else { return }
            let frontApp = NSWorkspace.shared.frontmostApplication?.localizedName ?? "unknown"
            self.requestCapture(
                app: frontApp,
                title: self.lastCapturedTitle,
                reason: "periodic",
                force: true
            )
        }

        emitEvent("system", [
            "message": "Screenshot capture monitoring started",
            "periodic_seconds": Int(SCREENSHOT_PERIODIC_INTERVAL),
            "cooldown_seconds": Int(SCREENSHOT_MIN_COOLDOWN)
        ])
    }

    func appSwitched(app: String, title: String = "") {
        requestCapture(app: app, title: title, reason: "app_switch", force: true)
    }

    func windowChanged(app: String, title: String) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        requestCapture(app: app, title: trimmed, reason: "window_change", force: false)
    }

    private func ensureDir() {
        do {
            try FileManager.default.createDirectory(at: screenshotsDir, withIntermediateDirectories: true)
        } catch {
            emitEvent("error", ["message": "Failed to create screenshots directory: \(error.localizedDescription)"])
        }
    }

    private func requestCapture(app: String, title: String, reason: String, force: Bool) {
        let cleanApp = normalizeApp(app)
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let now = Date()
        let sinceLast = now.timeIntervalSince(lastCaptureTime)

        if sinceLast < SCREENSHOT_MIN_COOLDOWN { return }

        if !force {
            let sameContext = (cleanApp == lastCapturedApp) && (cleanTitle == lastCapturedTitle)
            if sameContext && sinceLast < SCREENSHOT_PERIODIC_INTERVAL { return }
        }

        if reason == "window_change" && cleanTitle == lastCapturedTitle && cleanApp == lastCapturedApp {
            return
        }

        capture(app: cleanApp, title: cleanTitle, reason: reason)
    }

    private func capture(app: String, title: String, reason: String) {
        if isCapturing { return }
        isCapturing = true

        Task { @MainActor in
            defer { self.isCapturing = false }
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                guard let display = content.displays.first else {
                    emitEvent("error", ["message": "Screenshot capture: no display available"])
                    return
                }

                let filter = SCContentFilter(display: display, excludingWindows: [])
                let config = SCStreamConfiguration()
                config.width = display.width
                config.height = display.height
                config.showsCursor = true

                let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
                let rep = NSBitmapImageRep(cgImage: image)
                guard let jpegData = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.6]) else {
                    emitEvent("error", ["message": "Screenshot capture: failed to encode JPEG"])
                    return
                }

                let ts = formatter.string(from: Date())
                let filename = "\(ts)_\(sanitizeForFile(app)).jpg"
                let fileURL = screenshotsDir.appendingPathComponent(filename)
                try jpegData.write(to: fileURL, options: .atomic)

                lastCaptureTime = Date()
                lastCapturedApp = app
                if !title.isEmpty { lastCapturedTitle = title }

                emitEvent("screenshot_captured", [
                    "filepath": fileURL.path,
                    "app": app,
                    "title": title,
                    "reason": reason,
                    "bytes": jpegData.count
                ])
            } catch {
                if !permissionErrorLogged {
                    permissionErrorLogged = true
                    emitEvent("error", ["message": "Screenshot capture failed: \(error.localizedDescription)"])
                }
            }
        }
    }

    private func normalizeApp(_ app: String) -> String {
        let trimmed = app.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "unknown" : trimmed
    }

    private func sanitizeForFile(_ input: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        let mapped = input.unicodeScalars.map { allowed.contains($0) ? Character($0) : "_" }
        let joined = String(mapped)
        let collapsed = joined.replacingOccurrences(of: "_+", with: "_", options: .regularExpression)
        let trimmed = collapsed.trimmingCharacters(in: CharacterSet(charactersIn: "_"))
        if trimmed.isEmpty { return "unknown" }
        return String(trimmed.prefix(48))
    }
}

// MARK: - App & Window Monitoring

class AppMonitor {
    var lastApp = ""
    var lastWindow = ""
    let screenshotCaptor: ScreenshotCaptor

    init(screenshotCaptor: ScreenshotCaptor) {
        self.screenshotCaptor = screenshotCaptor
    }
    
    func start() {
        // Monitor app switches
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil, queue: .main
        ) { [weak self] notification in
            guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            let appName = app.localizedName ?? "unknown"
            if appName != self?.lastApp {
                self?.lastApp = appName
                let title = self?.focusedWindowTitle(for: app) ?? ""
                emitEvent("app_switch", [
                    "app": appName,
                    "bundle_id": app.bundleIdentifier ?? "",
                    "pid": app.processIdentifier
                ])
                self?.screenshotCaptor.appSwitched(app: appName, title: title)
            }
        }
        
        // Monitor screen lock/unlock
        DistributedNotificationCenter.default().addObserver(
            forName: NSNotification.Name("com.apple.screenIsLocked"),
            object: nil, queue: .main
        ) { _ in
            emitEvent("screen", ["state": "locked"])
        }
        
        DistributedNotificationCenter.default().addObserver(
            forName: NSNotification.Name("com.apple.screenIsUnlocked"),
            object: nil, queue: .main
        ) { _ in
            emitEvent("screen", ["state": "unlocked"])
        }
        
        // Monitor sleep/wake
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.willSleepNotification,
            object: nil, queue: .main
        ) { _ in
            emitEvent("power", ["state": "sleep"])
        }
        
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil, queue: .main
        ) { _ in
            emitEvent("power", ["state": "wake"])
        }
        
        // Periodic: running apps, window titles
        Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.reportAppState()
        }
        
        emitEvent("system", ["message": "App monitoring started"])
    }
    
    func reportAppState() {
        let frontAppRef = NSWorkspace.shared.frontmostApplication
        let frontApp = frontAppRef?.localizedName ?? "unknown"
        let windowTitle = focusedWindowTitle(for: frontAppRef)
        
        if windowTitle != lastWindow {
            lastWindow = windowTitle
            emitEvent("window_change", [
                "app": frontApp,
                "title": windowTitle
            ])
            screenshotCaptor.windowChanged(app: frontApp, title: windowTitle)
        }
    }

    private func focusedWindowTitle(for app: NSRunningApplication?) -> String {
        guard let app else { return "" }
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        var value: AnyObject?
        AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &value)
        guard let window = value else { return "" }
        var titleValue: AnyObject?
        AXUIElementCopyAttributeValue(window as! AXUIElement, kAXTitleAttribute as CFString, &titleValue)
        return titleValue as? String ?? ""
    }
}

// MARK: - Interoceptive Monitor

class InteroMonitor {
    func start() {
        Timer.scheduledTimer(withTimeInterval: INTERO_INTERVAL, repeats: true) { [weak self] _ in
            self?.report()
        }
        emitEvent("system", ["message": "Interoceptive monitoring started"])
    }
    
    func report() {
        // Battery
        var batteryLevel: Int = 100
        var isCharging = false
        
        if let powerSource = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
           let sources = IOPSCopyPowerSourcesList(powerSource)?.takeRetainedValue() as? [Any],
           let source = sources.first {
            if let desc = IOPSGetPowerSourceDescription(powerSource, source as CFTypeRef)?.takeUnretainedValue() as? [String: Any] {
                batteryLevel = desc[kIOPSCurrentCapacityKey] as? Int ?? 100
                let state = desc[kIOPSPowerSourceStateKey] as? String ?? ""
                isCharging = state == kIOPSACPowerValue
            }
        }
        
        // Thermal
        let thermalState = ProcessInfo.processInfo.thermalState
        let thermalString: String
        switch thermalState {
        case .nominal: thermalString = "nominal"
        case .fair: thermalString = "fair"
        case .serious: thermalString = "serious"
        case .critical: thermalString = "critical"
        @unknown default: thermalString = "unknown"
        }
        
        // Memory
        var vmStats = vm_statistics64()
        var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64>.size / MemoryLayout<integer_t>.size)
        let result = withUnsafeMutablePointer(to: &vmStats) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count)
            }
        }
        
        let pageSize = UInt64(vm_kernel_page_size)
        let totalMem = ProcessInfo.processInfo.physicalMemory
        let usedMem = result == KERN_SUCCESS ? 
            UInt64(vmStats.active_count + vmStats.wire_count) * pageSize : 0
        let memPressure = totalMem > 0 ? Double(usedMem) / Double(totalMem) : 0
        
        emitEvent("interoception", [
            "battery_level": batteryLevel,
            "battery_charging": isCharging,
            "thermal_state": thermalString,
            "memory_pressure": round(memPressure * 100) / 100,
            "physical_memory_gb": round(Double(totalMem) / 1073741824 * 10) / 10,
            "processor_count": ProcessInfo.processInfo.processorCount,
            "active_processor_count": ProcessInfo.processInfo.activeProcessorCount,
            "uptime_hours": round(ProcessInfo.processInfo.systemUptime / 3600 * 10) / 10
        ])
    }
}

// MARK: - Audio Monitor  

class AudioMonitor {
    func start() {
        Timer.scheduledTimer(withTimeInterval: 10.0, repeats: true) { [weak self] _ in
            self?.checkNowPlaying()
        }
        emitEvent("system", ["message": "Audio monitoring started"])
    }
    
    func checkNowPlaying() {
        // Use MediaRemote framework (private but available)
        // For now, check Music.app via AppleScript
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        task.arguments = ["-e", """
            try
                tell application "Music"
                    if player state is playing then
                        set t to name of current track
                        set a to artist of current track
                        return t & " — " & a
                    end if
                end tell
            end try
            return ""
        """]
        
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice
        
        try? task.run()
        task.waitUntilExit()
        
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        
        if !output.isEmpty {
            emitEvent("audio", ["now_playing": output, "source": "Music.app"])
        }
    }
}

// MARK: - User Idle Detection

class IdleMonitor {
    var wasIdle = false
    
    func start() {
        Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.check()
        }
    }
    
    func check() {
        var idleTime: CFTimeInterval = 0
        // Get idle time from IOKit
        let service = IOServiceGetMatchingService(0, IOServiceMatching("IOHIDSystem"))
        if service != 0 {
            if let props = IORegistryEntryCreateCFProperty(service, "HIDIdleTime" as CFString, kCFAllocatorDefault, 0) {
                idleTime = (props.takeRetainedValue() as? Double ?? 0) / 1_000_000_000
            }
            IOObjectRelease(service)
        }
        
        let isIdle = idleTime > IDLE_THRESHOLD
        
        if isIdle != wasIdle {
            wasIdle = isIdle
            emitEvent("user_presence", [
                "state": isIdle ? "idle" : "active",
                "idle_seconds": Int(idleTime)
            ])
        }
    }
}

// MARK: - Main

emitEvent("system", ["message": "oneiro-sensory starting", "version": "0.1.0"])

let hidMonitor = HIDMonitor()
let screenshotCaptor = ScreenshotCaptor()
let appMonitor = AppMonitor(screenshotCaptor: screenshotCaptor)
let interoMonitor = InteroMonitor()
let audioMonitor = AudioMonitor()
let idleMonitor = IdleMonitor()

hidMonitor.start()
screenshotCaptor.start()
appMonitor.start()
interoMonitor.start()
audioMonitor.start()
idleMonitor.start()

emitEvent("system", ["message": "All sensory channels online"])

// Keep running
RunLoop.current.run()
