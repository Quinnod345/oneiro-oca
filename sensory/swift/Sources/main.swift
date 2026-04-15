// oneiro-sensory — OCA Sensory Cortex (Swift)
// SPEC Section 5: Full multi-modal perception with continuous capture,
// sensory integration, and cross-process IPC via Unix domain socket +
// shared PerceptualState file.
//
// Runs as independent launchd service (com.oneiro.sensory).
// Outputs: JSON events to stdout (backward compat) + Unix socket + shared state file.

import Cocoa
import CoreGraphics
import ScreenCaptureKit
import AVFoundation
import IOKit
import IOKit.ps
import Speech

// ═══════════════════════════════════════════════════
// CONFIGURATION (SPEC §5.2 Capture Parameters)
// ═══════════════════════════════════════════════════

struct Config {
    static let activeFPS: Double = 2.0
    static let idleFPS: Double = 0.2
    static let burstFPS: Double = 10.0
    static let changeThreshold: Double = 0.05      // 5% pixel difference
    static let hidMetricsInterval: TimeInterval = 5.0
    static let interoInterval: TimeInterval = 10.0
    static let proprioInterval: TimeInterval = 5.0
    static let temporalInterval: TimeInterval = 2.0
    static let audioInterval: TimeInterval = 5.0
    static let idleThreshold: TimeInterval = 30.0
    static let integrationInterval: TimeInterval = 1.0 // unified state write
    static let screenshotsDir = "/Users/quinnodonnell/.openclaw/workspace/oneiro-core/screenshots"
    static let socketPath = "/tmp/oneiro-sensory.sock"
    static let sharedStatePath = "/tmp/oneiro-state/perception.json"
    static let sharedStateTmpPrefix = "/tmp/oneiro-state/perception.json.tmp"

    /// Skip SCStream / SCScreenshotManager so macOS does not keep "Screen Recording" active (DRM video e.g. Netflix).
    /// Set `ONEIRO_DISABLE_SCREEN_CAPTURE=0` in the environment to re-enable continuous capture.
    static func isScreenCaptureDisabled() -> Bool {
        guard let raw = ProcessInfo.processInfo.environment["ONEIRO_DISABLE_SCREEN_CAPTURE"] else {
            return false
        }
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if s.isEmpty { return false }
        if ["0", "false", "no", "off"].contains(s) { return false }
        return true
    }

    /// Open `AVAudioEngine` microphone tap only when explicitly requested. Keeping input **off** by default avoids Core Audio
    /// duplex glitches (crackling) with YouTube, Music, browser playback. Now-playing polling still runs without this.
    /// Set `ONEIRO_ENABLE_MIC_CAPTURE=1` in `oneiro-core/.env` (picked up by `run-sensory.sh`).
    static func isMicCaptureEnabled() -> Bool {
        guard let raw = ProcessInfo.processInfo.environment["ONEIRO_ENABLE_MIC_CAPTURE"] else {
            return false
        }
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if s.isEmpty { return false }
        return ["1", "true", "yes", "on"].contains(s)
    }
}

// ═══════════════════════════════════════════════════
// IPC: Unix Domain Socket Server
// ═══════════════════════════════════════════════════

import Foundation

class SocketServer {
    private var listener: FileHandle?
    private var clients: [FileHandle] = []
    private let path: String
    private var socketFD: Int32 = -1

    init(path: String) {
        self.path = path
    }

    func start() {
        unlink(path)
        socketFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard socketFD >= 0 else {
            emitEvent("error", ["message": "Failed to create Unix socket"])
            return
        }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = path.utf8CString
        withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
            let bound = ptr.withMemoryRebound(to: CChar.self, capacity: 104) { dest in
                pathBytes.withUnsafeBufferPointer { src in
                    let count = min(src.count, 104)
                    dest.update(from: src.baseAddress!, count: count)
                }
            }
        }

        let bindResult = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                bind(socketFD, sockPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bindResult == 0 else {
            emitEvent("error", ["message": "Failed to bind Unix socket: \(String(cString: strerror(errno)))"])
            return
        }

        listen(socketFD, 5)
        emitEvent("system", ["message": "Socket server listening on \(path)"])

        DispatchQueue.global(qos: .utility).async { [weak self] in
            while true {
                let clientFD = Darwin.accept(self?.socketFD ?? -1, nil, nil)
                if clientFD < 0 { break }
                let handle = FileHandle(fileDescriptor: clientFD, closeOnDealloc: true)
                self?.clients.append(handle)
            }
        }
    }

    func broadcast(_ message: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: message),
              var str = String(data: data, encoding: .utf8) else { return }
        str += "\n"
        guard let lineData = str.data(using: .utf8) else { return }
        clients.removeAll { handle in
            do {
                try handle.write(contentsOf: lineData)
                return false
            } catch {
                return true
            }
        }
    }
}

// ═══════════════════════════════════════════════════
// EVENT OUTPUT (stdout JSON lines + socket broadcast)
// ═══════════════════════════════════════════════════

let isoFormatter = ISO8601DateFormatter()
var socketServer: SocketServer?

func emitEvent(_ type: String, _ payload: [String: Any]) {
    let event: [String: Any] = [
        "type": type,
        "timestamp": isoFormatter.string(from: Date()),
        "payload": payload
    ]
    if let data = try? JSONSerialization.data(withJSONObject: event),
       let str = String(data: data, encoding: .utf8) {
        print(str)
        fflush(stdout)
    }
    socketServer?.broadcast(event)
}

// ═══════════════════════════════════════════════════
// MARK: - VISUAL PERCEPTION (SPEC §5.2)
// Continuous SCStream capture with frame differencing
// and Accessibility-based scene graph
// ═══════════════════════════════════════════════════

class VisualCortex: NSObject, SCStreamOutput {
    private var stream: SCStream?
    private var lastPixelBuffer: CVPixelBuffer?
    private var lastCaptureTime = Date.distantPast
    private var lastSignificantChangeTime = Date()
    private var currentFPS: Double = Config.activeFPS
    private var framesSinceChange = 0
    private var isUserIdle = false
    private var lastSceneGraph: [String: Any] = [:]
    private let screenshotsDir: URL
    private var lastSavedScreenshotTime = Date.distantPast
    private let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone.current
        f.dateFormat = "yyyy-MM-dd_HH-mm-ss"
        return f
    }()

    override init() {
        screenshotsDir = URL(fileURLWithPath: Config.screenshotsDir)
        super.init()
        try? FileManager.default.createDirectory(at: screenshotsDir, withIntermediateDirectories: true)
    }

    func start() async {
        if Config.isScreenCaptureDisabled() {
            emitEvent("system", [
                "message": "Visual cortex: screen capture disabled (ONEIRO_DISABLE_SCREEN_CAPTURE); Accessibility scene graph only"
            ])
            Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
                self?.buildSceneGraph()
            }
            return
        }

        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            guard let display = content.displays.first else {
                emitEvent("error", ["message": "No display found for visual capture"])
                return
            }

            let filter = SCContentFilter(display: display, excludingWindows: [])
            let config = SCStreamConfiguration()
            config.width = display.width / 2    // downsample 2x per SPEC
            config.height = display.height / 2
            config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(Config.activeFPS))
            config.showsCursor = true
            config.pixelFormat = kCVPixelFormatType_32BGRA

            stream = SCStream(filter: filter, configuration: config, delegate: nil)
            try stream?.addStreamOutput(self, type: .screen, sampleHandlerQueue: DispatchQueue(label: "visual-cortex"))
            try await stream?.startCapture()

            emitEvent("system", ["message": "Visual cortex online (SCStream continuous capture)"])

            // Periodic scene graph via Accessibility
            Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
                self?.buildSceneGraph()
            }
        } catch {
            emitEvent("error", ["message": "Visual cortex failed: \(error.localizedDescription)"])
            startFallbackCapture()
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen else { return }
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let now = Date()

        let changeRatio = computeChangeRatio(current: pixelBuffer, previous: lastPixelBuffer)
        let significantChange = changeRatio > Config.changeThreshold

        if significantChange {
            framesSinceChange = 0
            lastSignificantChangeTime = now

            // Save periodic screenshots for visual memory indexer
            if now.timeIntervalSince(lastSavedScreenshotTime) > 30 {
                saveScreenshot(pixelBuffer: pixelBuffer)
                lastSavedScreenshotTime = now
            }

            emitEvent("visual_change", [
                "change_ratio": round(changeRatio * 1000) / 1000,
                "fps": currentFPS
            ])
        } else {
            framesSinceChange += 1
        }

        lastPixelBuffer = pixelBuffer
        lastCaptureTime = now
        adaptFPS()
    }

    private func computeChangeRatio(current: CVPixelBuffer, previous: CVPixelBuffer?) -> Double {
        guard let prev = previous else { return 1.0 }

        CVPixelBufferLockBaseAddress(current, .readOnly)
        CVPixelBufferLockBaseAddress(prev, .readOnly)
        defer {
            CVPixelBufferUnlockBaseAddress(current, .readOnly)
            CVPixelBufferUnlockBaseAddress(prev, .readOnly)
        }

        guard let curBase = CVPixelBufferGetBaseAddress(current),
              let prevBase = CVPixelBufferGetBaseAddress(prev) else { return 1.0 }

        let width = CVPixelBufferGetWidth(current)
        let height = CVPixelBufferGetHeight(current)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(current)
        let prevBytesPerRow = CVPixelBufferGetBytesPerRow(prev)

        guard width == CVPixelBufferGetWidth(prev),
              height == CVPixelBufferGetHeight(prev) else { return 1.0 }

        // Sample every 8th pixel for performance
        let step = 8
        var diffCount = 0
        var totalSampled = 0

        for y in Swift.stride(from: 0, to: height, by: step) {
            let curRow = curBase.advanced(by: y * bytesPerRow)
            let prevRow = prevBase.advanced(by: y * prevBytesPerRow)
            for x in Swift.stride(from: 0, to: width * 4, by: step * 4) {
                totalSampled += 1
                let curPixel = curRow.load(fromByteOffset: x, as: UInt32.self)
                let prevPixel = prevRow.load(fromByteOffset: x, as: UInt32.self)
                if curPixel != prevPixel { diffCount += 1 }
            }
        }

        return totalSampled > 0 ? Double(diffCount) / Double(totalSampled) : 0
    }

    private func adaptFPS() {
        let secsSinceChange = Date().timeIntervalSince(lastSignificantChangeTime)
        if isUserIdle {
            currentFPS = Config.idleFPS
        } else if secsSinceChange < 2.0 {
            currentFPS = Config.burstFPS
        } else if secsSinceChange < 10.0 {
            currentFPS = Config.activeFPS
        } else {
            currentFPS = max(Config.idleFPS, Config.activeFPS / 2)
        }

        if let s = stream {
            let config = SCStreamConfiguration()
            config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(currentFPS))
            s.updateConfiguration(config) { _ in }
        }
    }

    func setIdle(_ idle: Bool) { isUserIdle = idle }

    func buildSceneGraph() {
        let frontApp = NSWorkspace.shared.frontmostApplication
        let appName = frontApp?.localizedName ?? "unknown"
        let bundleId = frontApp?.bundleIdentifier ?? ""
        let pid = frontApp?.processIdentifier ?? 0

        var windowTitle = ""
        var uiElements: [[String: Any]] = []
        if let app = frontApp {
            let axApp = AXUIElementCreateApplication(app.processIdentifier)
            var focusedWindow: AnyObject?
            AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &focusedWindow)
            if let win = focusedWindow {
                var titleVal: AnyObject?
                AXUIElementCopyAttributeValue(win as! AXUIElement, kAXTitleAttribute as CFString, &titleVal)
                windowTitle = titleVal as? String ?? ""

                // Extract top-level UI roles
                var children: AnyObject?
                AXUIElementCopyAttributeValue(win as! AXUIElement, kAXChildrenAttribute as CFString, &children)
                if let kids = children as? [AXUIElement] {
                    for (i, child) in kids.prefix(20).enumerated() {
                        var role: AnyObject?
                        AXUIElementCopyAttributeValue(child, kAXRoleAttribute as CFString, &role)
                        uiElements.append(["index": i, "role": role as? String ?? "unknown"])
                    }
                }
            }
        }

        let runningApps = NSWorkspace.shared.runningApplications
            .filter { $0.activationPolicy == .regular }
            .map { $0.localizedName ?? "?" }

        let cursorPos = NSEvent.mouseLocation
        let screenFrame = NSScreen.main?.frame ?? .zero

        lastSceneGraph = [
            "active_app": appName,
            "bundle_id": bundleId,
            "pid": pid,
            "active_window": ["title": windowTitle, "ui_elements": uiElements],
            "running_apps": runningApps,
            "cursor_position": ["x": Int(cursorPos.x), "y": Int(screenFrame.height - cursorPos.y)],
            "display": [
                "width": Int(screenFrame.width),
                "height": Int(screenFrame.height)
            ]
        ]
    }

    func getSceneGraph() -> [String: Any] { return lastSceneGraph }
    func getLastChangeTime() -> Date { return lastSignificantChangeTime }

    private func saveScreenshot(pixelBuffer: CVPixelBuffer) {
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else { return }

        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(data: baseAddress, width: width, height: height,
                                       bitsPerComponent: 8, bytesPerRow: bytesPerRow,
                                       space: colorSpace,
                                       bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue),
              let cgImage = context.makeImage() else { return }

        let rep = NSBitmapImageRep(cgImage: cgImage)
        guard let jpegData = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.5]) else { return }

        let ts = dateFormatter.string(from: Date())
        let frontApp = NSWorkspace.shared.frontmostApplication?.localizedName ?? "unknown"
        let safe = frontApp.replacingOccurrences(of: "[^a-zA-Z0-9_-]", with: "_", options: .regularExpression)
        let filename = "\(ts)_\(safe.prefix(32)).jpg"
        let fileURL = screenshotsDir.appendingPathComponent(filename)

        do {
            try jpegData.write(to: fileURL, options: .atomic)
            emitEvent("screenshot_captured", [
                "filepath": fileURL.path,
                "app": frontApp,
                "bytes": jpegData.count,
                "reason": "visual_change"
            ])
        } catch {}
    }

    private func startFallbackCapture() {
        emitEvent("system", ["message": "Visual cortex using fallback periodic capture"])
        Timer.scheduledTimer(withTimeInterval: 1.0 / Config.activeFPS, repeats: true) { [weak self] _ in
            self?.fallbackCapture()
        }
    }

    private func fallbackCapture() {
        Task { @MainActor in
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                guard let display = content.displays.first else { return }
                let filter = SCContentFilter(display: display, excludingWindows: [])
                let config = SCStreamConfiguration()
                config.width = display.width / 2
                config.height = display.height / 2
                config.showsCursor = true
                _ = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
                buildSceneGraph()
            } catch {}
        }
    }
}

// ═══════════════════════════════════════════════════
// MARK: - AUDITORY PERCEPTION (SPEC §5.3)
// System audio monitoring + voice activity detection
// ═══════════════════════════════════════════════════

class AuditoryCortex {
    private var audioEngine: AVAudioEngine?
    /// All RMS / VAD state and `emitEvent` run here — never on the realtime audio tap thread (avoids output crackle).
    private let rmsQueue = DispatchQueue(label: "com.oneiro.sensory.auditory.rms", qos: .utility)
    private var lastRMS: Float = 0
    private var isSpeechDetected = false
    private var speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var nowPlaying: String = ""
    private var volumeHistory: [Float] = []

    func start() {
        startSystemAudioMonitoring()
        startNowPlayingMonitoring()

        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
        SFSpeechRecognizer.requestAuthorization { status in
            if status == .authorized {
                emitEvent("system", ["message": "Speech recognition authorized"])
            }
        }

        emitEvent("system", ["message": "Auditory cortex online"])
    }

    private func startSystemAudioMonitoring() {
        if !Config.isMicCaptureEnabled() {
            emitEvent("system", [
                "message": "Microphone capture off (default). Set ONEIRO_ENABLE_MIC_CAPTURE=1 in .env if you need RMS/VAD — input can crackle system audio."
            ])
            return
        }
        // Audio engine can crash in child-process mode (no tty, piped stdio).
        // Entire function is wrapped so audio failure doesn't kill the process.
        do {
            audioEngine = AVAudioEngine()
            guard let engine = audioEngine else { return }

            let inputNode = engine.inputNode
            let format = inputNode.outputFormat(forBus: 0)
            guard format.sampleRate > 0 else {
                emitEvent("system", ["message": "Audio: no valid input format, skipping microphone tap"])
                return
            }

            // Larger buffer + offload processing: fewer callbacks and no I/O on the realtime thread (fixes YouTube/Music crackle).
            let tapFrames: AVAudioFrameCount = 8192
            inputNode.installTap(onBus: 0, bufferSize: tapFrames, format: format) { [weak self] buffer, _ in
                guard let self = self else { return }
                let rms = Self.computeRMS(buffer)
                self.rmsQueue.async { [weak self] in
                    self?.handleRMSFromBackground(rms)
                }
            }

            try engine.start()
            emitEvent("system", ["message": "Audio engine started (microphone tap, background RMS)"])
        } catch {
            emitEvent("system", ["message": "Audio engine unavailable (non-fatal): \(error.localizedDescription)"])
            audioEngine = nil
        }
    }

    /// Runs on realtime audio thread — only cheap math, no allocations beyond loop.
    private static func computeRMS(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let channelData = buffer.floatChannelData?[0] else { return 0 }
        let frameCount = Int(buffer.frameLength)
        guard frameCount > 0 else { return 0 }
        var sumOfSquares: Float = 0
        for i in 0..<frameCount {
            let sample = channelData[i]
            sumOfSquares += sample * sample
        }
        return sqrt(sumOfSquares / Float(frameCount))
    }

    /// Runs on `rmsQueue` — safe to call `emitEvent` and resize arrays.
    private func handleRMSFromBackground(_ rms: Float) {
        lastRMS = rms
        volumeHistory.append(rms)
        if volumeHistory.count > 100 { volumeHistory.removeFirst() }

        let wasDetected = isSpeechDetected
        isSpeechDetected = rms > 0.01
        if isSpeechDetected && !wasDetected {
            emitEvent("audio_vad", ["state": "speech_start", "rms": rms])
        } else if !isSpeechDetected && wasDetected {
            emitEvent("audio_vad", ["state": "speech_end", "rms": rms])
        }
    }

    private func startNowPlayingMonitoring() {
        Timer.scheduledTimer(withTimeInterval: Config.audioInterval, repeats: true) { [weak self] _ in
            self?.checkNowPlaying()
        }
    }

    private func checkNowPlaying() {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        task.arguments = ["-e", """
            try
                if application "Music" is running then
                    tell application "Music"
                        if player state is playing then
                            set t to name of current track
                            set a to artist of current track
                            return t & " — " & a
                        end if
                    end tell
                end if
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

        if output != nowPlaying {
            nowPlaying = output
            if !output.isEmpty {
                emitEvent("audio_now_playing", ["track": output, "source": "Music.app"])
            }
        }
    }

    func getState() -> [String: Any] {
        rmsQueue.sync {
            let avgRMS = volumeHistory.isEmpty ? 0 : volumeHistory.reduce(0, +) / Float(volumeHistory.count)
            return [
                "rms_volume": round(Double(lastRMS) * 1000) / 1000,
                "avg_volume": round(Double(avgRMS) * 1000) / 1000,
                "speech_detected": isSpeechDetected,
                "now_playing": nowPlaying,
                "silence": lastRMS < 0.001,
                "mic_capture_enabled": Config.isMicCaptureEnabled()
            ]
        }
    }
}

// ═══════════════════════════════════════════════════
// MARK: - TACTILE PERCEPTION (SPEC §5.4)
// Full HID with derived metrics and target app tracking
// ═══════════════════════════════════════════════════

class TactileCortex {
    var keyDownCount = 0
    var keyUpCount = 0
    var backspaceCount = 0
    var mouseClickCount = 0
    var mouseMoveDistance: Double = 0
    var scrollDistance: Double = 0
    var lastMousePosition = CGPoint.zero
    var lastKeyTime: Date?
    var interKeyIntervals: [TimeInterval] = []
    var lastReportTime = Date()

    // Burst detection
    var burstStartTime: Date?
    var burstKeyCount = 0
    var bursts: [Int] = [] // keys per burst

    // Fitts's Law tracking
    var mousePathLength: Double = 0
    var mouseTargetDistance: Double = 0
    var clickPositions: [CGPoint] = []

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
                let cortex = Unmanaged<TactileCortex>.fromOpaque(refcon!).takeUnretainedValue()
                cortex.handleEvent(type: type, event: event)
                return Unmanaged.passRetained(event)
            },
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else {
            emitEvent("error", ["message": "Failed to create HID event tap. Grant Input Monitoring in System Settings."])
            return
        }

        eventTap = tap
        let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)

        emitEvent("system", ["message": "Tactile cortex online (HID monitoring)"])

        Timer.scheduledTimer(withTimeInterval: Config.hidMetricsInterval, repeats: true) { [weak self] _ in
            self?.reportMetrics()
        }
    }

    func handleEvent(type: CGEventType, event: CGEvent) {
        let now = Date()

        switch type {
        case .keyDown:
            keyDownCount += 1
            let keycode = event.getIntegerValueField(.keyboardEventKeycode)
            if keycode == 51 { backspaceCount += 1 }

            if let last = lastKeyTime {
                let interval = now.timeIntervalSince(last)
                if interval < 2.0 {
                    interKeyIntervals.append(interval)
                    if interKeyIntervals.count > 200 { interKeyIntervals.removeFirst() }
                }
                // Burst detection: keystrokes within 500ms of each other
                if interval < 0.5 {
                    burstKeyCount += 1
                    if burstStartTime == nil { burstStartTime = last }
                } else {
                    if burstKeyCount > 3 { bursts.append(burstKeyCount) }
                    if bursts.count > 20 { bursts.removeFirst() }
                    burstKeyCount = 1
                    burstStartTime = now
                }
            }
            lastKeyTime = now

        case .keyUp:
            keyUpCount += 1

        case .leftMouseDown, .rightMouseDown:
            mouseClickCount += 1
            let pos = event.location
            clickPositions.append(pos)
            if clickPositions.count > 50 { clickPositions.removeFirst() }
            // Fitts's Law: path efficiency = direct distance / actual path
            if mousePathLength > 0 && clickPositions.count >= 2 {
                let prev = clickPositions[clickPositions.count - 2]
                let direct = sqrt(pow(pos.x - prev.x, 2) + pow(pos.y - prev.y, 2))
                mouseTargetDistance = direct
            }

        case .mouseMoved:
            let pos = event.location
            let dx = pos.x - lastMousePosition.x
            let dy = pos.y - lastMousePosition.y
            let dist = sqrt(dx*dx + dy*dy)
            mouseMoveDistance += dist
            mousePathLength += dist
            lastMousePosition = pos

        case .scrollWheel:
            let dy = abs(event.getDoubleValueField(.scrollWheelEventDeltaAxis1))
            scrollDistance += dy

        default:
            break
        }
    }

    func reportMetrics() {
        let elapsed = Date().timeIntervalSince(lastReportTime)
        guard elapsed > 1 else { return }

        let wpm = (Double(keyDownCount) / 5.0) / (elapsed / 60.0)
        let errorRate = keyDownCount > 0 ? Double(backspaceCount) / Double(keyDownCount) : 0
        let avgIKI = interKeyIntervals.isEmpty ? 0 : interKeyIntervals.reduce(0, +) / Double(interKeyIntervals.count)
        let pathEfficiency = mousePathLength > 0 && mouseTargetDistance > 0
            ? min(1.0, mouseTargetDistance / mousePathLength) : 0

        let speedClass: String
        if wpm > 60 { speedClass = "fast" }
        else if wpm > 30 { speedClass = "moderate" }
        else if wpm > 5 { speedClass = "slow" }
        else { speedClass = "idle" }

        // IKI distribution for burst pattern analysis
        let sortedIKI = interKeyIntervals.sorted()
        let p50 = sortedIKI.isEmpty ? 0 : sortedIKI[sortedIKI.count / 2]
        let p90 = sortedIKI.isEmpty ? 0 : sortedIKI[min(sortedIKI.count - 1, Int(Double(sortedIKI.count) * 0.9))]

        let targetApp = NSWorkspace.shared.frontmostApplication?.localizedName ?? "unknown"

        emitEvent("hid_metrics", [
            "keystrokes": keyDownCount,
            "backspaces": backspaceCount,
            "clicks": mouseClickCount,
            "scroll_distance": round(scrollDistance),
            "mouse_distance": Int(mouseMoveDistance),
            "wpm": round(wpm * 10) / 10,
            "error_rate": round(errorRate * 1000) / 1000,
            "avg_iki_ms": round(avgIKI * 1000),
            "iki_p50_ms": round(p50 * 1000),
            "iki_p90_ms": round(p90 * 1000),
            "speed_class": speedClass,
            "burst_count": bursts.count,
            "avg_burst_length": bursts.isEmpty ? 0 : bursts.reduce(0, +) / bursts.count,
            "path_efficiency": round(pathEfficiency * 1000) / 1000,
            "target_app": targetApp,
            "elapsed_seconds": round(elapsed)
        ])

        keyDownCount = 0; keyUpCount = 0; backspaceCount = 0
        mouseClickCount = 0; mouseMoveDistance = 0; scrollDistance = 0
        mousePathLength = 0; mouseTargetDistance = 0
        interKeyIntervals = []; bursts = []
        lastReportTime = Date()
    }

    func getState() -> [String: Any] {
        let elapsed = Date().timeIntervalSince(lastReportTime)
        let wpm = elapsed > 0 ? (Double(keyDownCount) / 5.0) / (elapsed / 60.0) : 0
        return [
            "wpm": round(wpm * 10) / 10,
            "error_rate": keyDownCount > 0 ? round(Double(backspaceCount) / Double(keyDownCount) * 1000) / 1000 : 0,
            "mouse_position": ["x": Int(lastMousePosition.x), "y": Int(lastMousePosition.y)],
            "active_typing": wpm > 5,
            "active_clicking": mouseClickCount > 0
        ]
    }
}

// ═══════════════════════════════════════════════════
// MARK: - PROPRIOCEPTIVE PERCEPTION (SPEC §5.5)
// ═══════════════════════════════════════════════════

class ProprioceptiveCortex {
    private var lastState: [String: Any] = [:]

    func start() {
        Timer.scheduledTimer(withTimeInterval: Config.proprioInterval, repeats: true) { [weak self] _ in
            self?.report()
        }
        emitEvent("system", ["message": "Proprioceptive cortex online"])
    }

    func report() {
        let workspace = NSWorkspace.shared
        let frontApp = workspace.frontmostApplication?.localizedName ?? "unknown"
        let runningApps = workspace.runningApplications
            .filter { $0.activationPolicy == .regular }
            .map { $0.localizedName ?? "?" }

        // Clipboard contents (type only, not content for privacy)
        let pasteboard = NSPasteboard.general
        let clipboardTypes = pasteboard.types?.map { $0.rawValue } ?? []
        let clipboardHasText = pasteboard.string(forType: .string) != nil
        let clipboardHasImage = pasteboard.data(forType: .tiff) != nil

        lastState = [
            "front_app": frontApp,
            "running_apps": runningApps,
            "running_app_count": runningApps.count,
            "clipboard": [
                "has_text": clipboardHasText,
                "has_image": clipboardHasImage,
                "types_count": clipboardTypes.count
            ],
            "uptime_hours": round(ProcessInfo.processInfo.systemUptime / 3600 * 10) / 10
        ]
    }

    func getState() -> [String: Any] { return lastState }
}

// ═══════════════════════════════════════════════════
// MARK: - INTEROCEPTIVE PERCEPTION (SPEC §5.6)
// Battery, CPU, thermal, memory, disk
// ═══════════════════════════════════════════════════

class InteroceptiveCortex {
    private var lastState: [String: Any] = [:]

    func start() {
        Timer.scheduledTimer(withTimeInterval: Config.interoInterval, repeats: true) { [weak self] _ in
            self?.report()
        }
        emitEvent("system", ["message": "Interoceptive cortex online"])
    }

    func report() {
        // Battery — must use InternalBattery only; sources.first is often a BT accessory (wrong %).
        var batteryLevel: Int = 100
        var isCharging = false
        if let powerSource = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
           let sources = IOPSCopyPowerSourcesList(powerSource)?.takeRetainedValue() as? [Any] {
            let internalType = kIOPSInternalBatteryType as String
            for source in sources {
                guard let desc = IOPSGetPowerSourceDescription(powerSource, source as CFTypeRef)?.takeUnretainedValue() as? [String: Any] else { continue }
                let type = desc[kIOPSTypeKey] as? String ?? ""
                guard type == internalType else { continue }
                batteryLevel = desc[kIOPSCurrentCapacityKey] as? Int ?? 100
                isCharging = (desc[kIOPSPowerSourceStateKey] as? String ?? "") == kIOPSACPowerValue
                break
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

        // Memory pressure
        var vmStats = vm_statistics64()
        var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64>.size / MemoryLayout<integer_t>.size)
        let vmResult = withUnsafeMutablePointer(to: &vmStats) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count)
            }
        }
        let pageSize = UInt64(vm_kernel_page_size)
        let totalMem = ProcessInfo.processInfo.physicalMemory
        let usedMem = vmResult == KERN_SUCCESS ? UInt64(vmStats.active_count + vmStats.wire_count) * pageSize : 0
        let memPressure = totalMem > 0 ? Double(usedMem) / Double(totalMem) : 0

        // Disk space
        let homeURL = FileManager.default.homeDirectoryForCurrentUser
        let diskValues = try? homeURL.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeTotalCapacityKey])
        let diskFreeGB = Double(diskValues?.volumeAvailableCapacityForImportantUsage ?? 0) / 1_073_741_824
        let diskTotalGB = Double(diskValues?.volumeTotalCapacity ?? 0) / 1_073_741_824
        let diskUsageRatio = diskTotalGB > 0 ? (diskTotalGB - diskFreeGB) / diskTotalGB : 0

        // SPEC §5.6 Interoceptive Mapping
        let energyPolicy: String
        if batteryLevel < 20 && !isCharging { energyPolicy = "low_energy" }
        else if thermalString == "serious" || thermalString == "critical" { energyPolicy = "overheat_cooldown" }
        else if memPressure > 0.9 { energyPolicy = "cognitive_overload" }
        else if diskUsageRatio > 0.9 { energyPolicy = "storage_pressure" }
        else { energyPolicy = "nominal" }

        lastState = [
            "battery_level": batteryLevel,
            "battery_charging": isCharging,
            "thermal_state": thermalString,
            "memory_pressure": round(memPressure * 100) / 100,
            "physical_memory_gb": round(Double(totalMem) / 1_073_741_824 * 10) / 10,
            "processor_count": ProcessInfo.processInfo.processorCount,
            "active_processor_count": ProcessInfo.processInfo.activeProcessorCount,
            "uptime_hours": round(ProcessInfo.processInfo.systemUptime / 3600 * 10) / 10,
            "disk_free_gb": round(diskFreeGB * 10) / 10,
            "disk_total_gb": round(diskTotalGB * 10) / 10,
            "disk_usage_ratio": round(diskUsageRatio * 100) / 100,
            "energy_policy": energyPolicy
        ]

        emitEvent("interoception", lastState)
    }

    func getState() -> [String: Any] { return lastState }
}

// ═══════════════════════════════════════════════════
// MARK: - TEMPORAL PERCEPTION (SPEC §5.7)
// ═══════════════════════════════════════════════════

class TemporalCortex {
    var lastUserInteraction = Date()
    var lastCognitiveEvent = Date()
    var lastSurpriseEvent = Date()
    var lastSignificantEvent = Date()
    var sessionStartTime = Date()
    var dailyActivityPattern: [Int: Int] = [:] // hour -> interaction count
    private var lastState: [String: Any] = [:]

    func start() {
        Timer.scheduledTimer(withTimeInterval: Config.temporalInterval, repeats: true) { [weak self] _ in
            self?.update()
        }
        emitEvent("system", ["message": "Temporal cortex online"])
    }

    func recordUserInteraction() {
        lastUserInteraction = Date()
        let hour = Calendar.current.component(.hour, from: Date())
        dailyActivityPattern[hour, default: 0] += 1
    }

    func recordSurprise() { lastSurpriseEvent = Date() }
    func recordSignificantEvent() { lastSignificantEvent = Date() }
    func recordCognitiveEvent() { lastCognitiveEvent = Date() }

    func update() {
        let now = Date()
        let calendar = Calendar.current
        let hour = calendar.component(.hour, from: now)
        let dayOfWeek = calendar.component(.weekday, from: now)

        let timeSinceInteraction = now.timeIntervalSince(lastUserInteraction)
        let timeSinceCognitive = now.timeIntervalSince(lastCognitiveEvent)
        let timeSinceSurprise = now.timeIntervalSince(lastSurpriseEvent)
        let timeSinceSignificant = now.timeIntervalSince(lastSignificantEvent)
        let sessionDuration = now.timeIntervalSince(sessionStartTime)

        // Temporal anomaly: unusually long gap since last interaction for this hour
        let typicalActivityThisHour = dailyActivityPattern[hour, default: 0]
        let anomaly = timeSinceInteraction > 600 && typicalActivityThisHour > 10

        let timeOfDay: String
        if hour < 6 { timeOfDay = "night" }
        else if hour < 12 { timeOfDay = "morning" }
        else if hour < 17 { timeOfDay = "afternoon" }
        else if hour < 21 { timeOfDay = "evening" }
        else { timeOfDay = "night" }

        lastState = [
            "absolute": [
                "hour": hour,
                "day_of_week": dayOfWeek,
                "time_of_day": timeOfDay,
                "iso": isoFormatter.string(from: now)
            ],
            "relative": [
                "since_user_interaction_s": Int(timeSinceInteraction),
                "since_cognitive_event_s": Int(timeSinceCognitive),
                "since_surprise_s": Int(timeSinceSurprise),
                "since_significant_event_s": Int(timeSinceSignificant),
                "session_duration_s": Int(sessionDuration)
            ],
            "rhythms": [
                "typical_activity_this_hour": typicalActivityThisHour,
                "temporal_anomaly": anomaly
            ]
        ]
    }

    func getState() -> [String: Any] { return lastState }
}

// ═══════════════════════════════════════════════════
// MARK: - USER PRESENCE / IDLE DETECTION
// ═══════════════════════════════════════════════════

class PresenceMonitor {
    var isIdle = false
    var idleSeconds: TimeInterval = 0
    var state: String = "active" // active, idle, away

    func start() {
        Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            self?.check()
        }
    }

    func check() {
        var ioIdleTime: CFTimeInterval = 0
        let service = IOServiceGetMatchingService(0, IOServiceMatching("IOHIDSystem"))
        if service != 0 {
            if let props = IORegistryEntryCreateCFProperty(service, "HIDIdleTime" as CFString, kCFAllocatorDefault, 0) {
                ioIdleTime = (props.takeRetainedValue() as? Double ?? 0) / 1_000_000_000
            }
            IOObjectRelease(service)
        }

        idleSeconds = ioIdleTime
        isIdle = ioIdleTime > Config.idleThreshold

        let newState: String
        if ioIdleTime > 300 { newState = "away" }
        else if ioIdleTime > Config.idleThreshold { newState = "idle" }
        else { newState = "active" }

        if newState != state {
            state = newState
            emitEvent("user_presence", [
                "state": state,
                "idle_seconds": Int(ioIdleTime)
            ])
        }
    }

    func getPresence() -> String { return state }
    func getIdleSeconds() -> TimeInterval { return idleSeconds }
}

// ═══════════════════════════════════════════════════
// MARK: - POWER & SCREEN EVENTS
// ═══════════════════════════════════════════════════

class SystemEventMonitor {
    func start() {
        DistributedNotificationCenter.default().addObserver(
            forName: NSNotification.Name("com.apple.screenIsLocked"), object: nil, queue: .main
        ) { _ in emitEvent("screen", ["state": "locked"]) }

        DistributedNotificationCenter.default().addObserver(
            forName: NSNotification.Name("com.apple.screenIsUnlocked"), object: nil, queue: .main
        ) { _ in emitEvent("screen", ["state": "unlocked"]) }

        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.willSleepNotification, object: nil, queue: .main
        ) { _ in emitEvent("power", ["state": "sleep"]) }

        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
        ) { _ in emitEvent("power", ["state": "wake"]) }

        emitEvent("system", ["message": "System event monitoring started"])
    }
}

// ═══════════════════════════════════════════════════
// MARK: - SENSORY INTEGRATION (SPEC §5.8)
// Combines all channels into unified PerceptualState
// ═══════════════════════════════════════════════════

class SensoryIntegrator {
    let visual: VisualCortex
    let auditory: AuditoryCortex
    let tactile: TactileCortex
    let proprioceptive: ProprioceptiveCortex
    let interoceptive: InteroceptiveCortex
    let temporal: TemporalCortex
    let presence: PresenceMonitor

    private var previousState: [String: Any]?
    private var surprises: [[String: Any]] = []

    init(visual: VisualCortex, auditory: AuditoryCortex, tactile: TactileCortex,
         proprioceptive: ProprioceptiveCortex, interoceptive: InteroceptiveCortex,
         temporal: TemporalCortex, presence: PresenceMonitor) {
        self.visual = visual
        self.auditory = auditory
        self.tactile = tactile
        self.proprioceptive = proprioceptive
        self.interoceptive = interoceptive
        self.temporal = temporal
        self.presence = presence
    }

    func start() {
        Timer.scheduledTimer(withTimeInterval: Config.integrationInterval, repeats: true) { [weak self] _ in
            self?.integrate()
        }
        emitEvent("system", ["message": "Sensory integrator online"])
    }

    func integrate() {
        let tactileState = tactile.getState()
        let visualState = visual.getSceneGraph()
        let audioState = auditory.getState()
        let proprioState = proprioceptive.getState()
        let interoState = interoceptive.getState()
        let temporalState = temporal.getState()

        // Derive user activity
        let isTyping = tactileState["active_typing"] as? Bool ?? false
        let isClicking = tactileState["active_clicking"] as? Bool ?? false
        let frontApp = visualState["active_app"] as? String ?? "unknown"

        let userActivity: String
        if isTyping && isClicking { userActivity = "coding" }
        else if isTyping { userActivity = "typing" }
        else if isClicking { userActivity = "browsing" }
        else if presence.getPresence() == "active" { userActivity = "reading" }
        else { userActivity = "idle" }

        // Environment stability
        let secsSinceVisualChange = Date().timeIntervalSince(visual.getLastChangeTime())
        let environmentStability: String
        if secsSinceVisualChange < 2 { environmentStability = "volatile" }
        else if secsSinceVisualChange < 30 { environmentStability = "changing" }
        else { environmentStability = "stable" }

        // Compute prediction errors (surprises) against previous state
        computeSurprises(currentApp: frontApp, currentActivity: userActivity)

        let state: [String: Any] = [
            "timestamp": isoFormatter.string(from: Date()),
            "visual": visualState,
            "auditory": audioState,
            "tactile": tactileState,
            "proprioceptive": proprioState,
            "interoceptive": interoState,
            "temporal": temporalState,
            "user_presence": presence.getPresence(),
            "user_activity": userActivity,
            "environment_stability": environmentStability,
            "attention_target": frontApp,
            "surprises": surprises
        ]

        // Write to shared state file (atomic rename for crash safety)
        writeSharedState(state)

        // Emit integrated perception event
        emitEvent("perception_update", [
            "user_presence": presence.getPresence(),
            "user_activity": userActivity,
            "front_app": frontApp,
            "environment_stability": environmentStability,
            "surprise_count": surprises.count
        ])

        previousState = state
        surprises = []
    }

    private func computeSurprises(currentApp: String, currentActivity: String) {
        guard let prev = previousState else { return }
        let prevApp = (prev["visual"] as? [String: Any])?["active_app"] as? String ?? ""
        let prevActivity = prev["user_activity"] as? String ?? ""

        if currentApp != prevApp && !prevApp.isEmpty {
            surprises.append([
                "channel": "visual",
                "predicted": prevApp,
                "actual": currentApp,
                "magnitude": 0.3
            ])
        }

        if currentActivity != prevActivity && !prevActivity.isEmpty {
            surprises.append([
                "channel": "activity",
                "predicted": prevActivity,
                "actual": currentActivity,
                "magnitude": 0.2
            ])
        }
    }

    private func writeSharedState(_ state: [String: Any]) {
        let dir = "/tmp/oneiro-state"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let target = Config.sharedStatePath
        let tmp = "\(Config.sharedStateTmpPrefix).\(ProcessInfo.processInfo.processIdentifier)"
        guard let data = try? JSONSerialization.data(withJSONObject: state, options: []),
              let str = String(data: data, encoding: .utf8) else { return }
        do {
            try str.write(toFile: tmp, atomically: false, encoding: .utf8)
            try FileManager.default.moveItem(atPath: tmp, toPath: target)
        } catch {
            try? FileManager.default.removeItem(atPath: tmp)
        }
    }
}

// ═══════════════════════════════════════════════════
// MARK: - MAIN: Boot all sensory channels
// ═══════════════════════════════════════════════════

// Ignore SIGPIPE -- critical for child process mode where parent may close pipes
signal(SIGPIPE, SIG_IGN)

emitEvent("system", ["message": "oneiro-sensory starting", "version": "1.0.0"])

// Initialize all cortices
let visualCortex = VisualCortex()
let auditoryCortex = AuditoryCortex()
let tactileCortex = TactileCortex()
let proprioCortex = ProprioceptiveCortex()
let interoCortex = InteroceptiveCortex()
let temporalCortex = TemporalCortex()
let presenceMonitor = PresenceMonitor()
let systemMonitor = SystemEventMonitor()

let integrator = SensoryIntegrator(
    visual: visualCortex, auditory: auditoryCortex, tactile: tactileCortex,
    proprioceptive: proprioCortex, interoceptive: interoCortex,
    temporal: temporalCortex, presence: presenceMonitor
)

// Start IPC
socketServer = SocketServer(path: Config.socketPath)
socketServer?.start()

// Boot order: HID first (needs RunLoop), then visual (async), then rest
tactileCortex.start()
presenceMonitor.start()
systemMonitor.start()
auditoryCortex.start()
proprioCortex.start()
interoCortex.start()
temporalCortex.start()
integrator.start()

// Visual cortex needs async start
Task {
    await visualCortex.start()
}

// Wire presence changes to visual + temporal
Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { _ in
    visualCortex.setIdle(presenceMonitor.isIdle)
    if !presenceMonitor.isIdle { temporalCortex.recordUserInteraction() }
}

emitEvent("system", ["message": "All sensory channels online"])

RunLoop.current.run()
