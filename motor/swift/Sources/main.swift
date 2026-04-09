// oneiro-motor — OCA Motor Cortex (Swift)
// SPEC Section 6: CGEvent-based keystroke/mouse synthesis, app control,
// AppleScript bridge, and system control.
//
// Runs as independent launchd service (com.oneiro.motor).
// Listens on Unix domain socket for JSON motor commands from the cognitive process.
// Returns execution results including sensory verification.

import Cocoa
import CoreGraphics
import ApplicationServices
import Foundation

// ═══════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════

let SOCKET_PATH = "/tmp/oneiro-motor.sock"
let LOG_PREFIX = "[motor]"

// ═══════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════

func log(_ msg: String) {
    let ts = ISO8601DateFormatter().string(from: Date())
    print("\(LOG_PREFIX) [\(ts)] \(msg)")
    fflush(stdout)
}

func logJSON(_ event: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: event),
       let str = String(data: data, encoding: .utf8) {
        print(str)
        fflush(stdout)
    }
}

// ═══════════════════════════════════════════════════
// MARK: - KEYSTROKE GENERATION (SPEC §6.2.1)
// CGEvent-based with configurable speed
// ═══════════════════════════════════════════════════

enum TypingSpeed: String {
    case instant = "instant"
    case natural = "natural"       // 40-80ms inter-key
    case deliberate = "deliberate" // 100-200ms inter-key

    var delay: (min: UInt32, max: UInt32) {
        switch self {
        case .instant: return (0, 0)
        case .natural: return (40_000, 80_000) // microseconds
        case .deliberate: return (100_000, 200_000)
        }
    }
}

func typeText(_ text: String, speed: TypingSpeed = .instant) -> [String: Any] {
    let source = CGEventSource(stateID: .combinedSessionState)
    var typed = 0

    for char in text {
        let str = String(char)
        let unichars = Array(str.utf16)

        let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
        keyDown?.keyboardSetUnicodeString(stringLength: unichars.count, unicodeString: unichars)
        keyDown?.post(tap: .cghidEventTap)

        let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
        keyUp?.keyboardSetUnicodeString(stringLength: unichars.count, unicodeString: unichars)
        keyUp?.post(tap: .cghidEventTap)

        typed += 1

        if speed != .instant {
            let range = speed.delay
            let delay = range.min + arc4random_uniform(range.max - range.min + 1)
            usleep(delay)
        }
    }

    return ["success": true, "characters_typed": typed]
}

func pressKey(keyCode: Int, modifiers: [String] = []) -> [String: Any] {
    let source = CGEventSource(stateID: .combinedSessionState)
    guard let keyDown = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(keyCode), keyDown: true),
          let keyUp = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(keyCode), keyDown: false) else {
        return ["success": false, "error": "Failed to create key events"]
    }

    var flags: CGEventFlags = []
    for mod in modifiers {
        switch mod.lowercased() {
        case "command", "cmd": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "option", "alt": flags.insert(.maskAlternate)
        case "control", "ctrl": flags.insert(.maskControl)
        default: break
        }
    }
    keyDown.flags = flags
    keyUp.flags = flags

    keyDown.post(tap: .cghidEventTap)
    keyUp.post(tap: .cghidEventTap)

    return ["success": true, "key_code": keyCode, "modifiers": modifiers]
}

// ═══════════════════════════════════════════════════
// MARK: - MOUSE CONTROL (SPEC §6.2.2)
// CGEvent-based with Bezier curve path planning
// ═══════════════════════════════════════════════════

func mouseClick(x: Double, y: Double, button: String = "left") -> [String: Any] {
    let point = CGPoint(x: x, y: y)
    let source = CGEventSource(stateID: .combinedSessionState)

    let mouseType: CGEventType
    let mouseUpType: CGEventType
    let mouseButton: CGMouseButton

    switch button {
    case "right":
        mouseType = .rightMouseDown; mouseUpType = .rightMouseUp; mouseButton = .right
    default:
        mouseType = .leftMouseDown; mouseUpType = .leftMouseUp; mouseButton = .left
    }

    let down = CGEvent(mouseEventSource: source, mouseType: mouseType, mouseCursorPosition: point, mouseButton: mouseButton)
    let up = CGEvent(mouseEventSource: source, mouseType: mouseUpType, mouseCursorPosition: point, mouseButton: mouseButton)

    down?.post(tap: .cghidEventTap)
    usleep(50_000) // 50ms between down and up
    up?.post(tap: .cghidEventTap)

    return ["success": true, "position": ["x": x, "y": y], "button": button]
}

func mouseDoubleClick(x: Double, y: Double) -> [String: Any] {
    let point = CGPoint(x: x, y: y)
    let source = CGEventSource(stateID: .combinedSessionState)

    let down1 = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
    let up1 = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
    let down2 = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
    let up2 = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)

    down1?.setIntegerValueField(.mouseEventClickState, value: 1)
    up1?.setIntegerValueField(.mouseEventClickState, value: 1)
    down2?.setIntegerValueField(.mouseEventClickState, value: 2)
    up2?.setIntegerValueField(.mouseEventClickState, value: 2)

    down1?.post(tap: .cghidEventTap); usleep(30_000)
    up1?.post(tap: .cghidEventTap); usleep(30_000)
    down2?.post(tap: .cghidEventTap); usleep(30_000)
    up2?.post(tap: .cghidEventTap)

    return ["success": true, "position": ["x": x, "y": y], "action": "double_click"]
}

func mouseMove(x: Double, y: Double, duration: Double = 0) -> [String: Any] {
    let target = CGPoint(x: x, y: y)

    if duration <= 0 {
        let source = CGEventSource(stateID: .combinedSessionState)
        let move = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: target, mouseButton: .left)
        move?.post(tap: .cghidEventTap)
        return ["success": true, "position": ["x": x, "y": y]]
    }

    // Bezier curve movement for natural-looking motion
    let currentEvent = CGEvent(source: nil)
    let start = currentEvent?.location ?? CGPoint.zero
    let steps = max(10, Int(duration * 60)) // ~60 fps
    let stepDelay = UInt32(duration / Double(steps) * 1_000_000)

    for i in 1...steps {
        let t = Double(i) / Double(steps)
        // Ease in-out cubic
        let eased = t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
        let px = start.x + CGFloat(eased) * (target.x - start.x)
        let py = start.y + CGFloat(eased) * (target.y - start.y)

        let source = CGEventSource(stateID: .combinedSessionState)
        let move = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: px, y: py), mouseButton: .left)
        move?.post(tap: .cghidEventTap)
        usleep(stepDelay)
    }

    return ["success": true, "position": ["x": x, "y": y], "duration": duration]
}

func mouseDrag(fromX: Double, fromY: Double, toX: Double, toY: Double, duration: Double = 0.3) -> [String: Any] {
    let source = CGEventSource(stateID: .combinedSessionState)
    let start = CGPoint(x: fromX, y: fromY)
    let end = CGPoint(x: toX, y: toY)

    let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: start, mouseButton: .left)
    down?.post(tap: .cghidEventTap)

    let steps = max(10, Int(duration * 60))
    let stepDelay = UInt32(duration / Double(steps) * 1_000_000)

    for i in 1...steps {
        let t = Double(i) / Double(steps)
        let eased = t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
        let px = start.x + CGFloat(eased) * (end.x - start.x)
        let py = start.y + CGFloat(eased) * (end.y - start.y)

        let drag = CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: CGPoint(x: px, y: py), mouseButton: .left)
        drag?.post(tap: .cghidEventTap)
        usleep(stepDelay)
    }

    let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: end, mouseButton: .left)
    up?.post(tap: .cghidEventTap)

    return ["success": true, "from": ["x": fromX, "y": fromY], "to": ["x": toX, "y": toY]]
}

func mouseScroll(deltaY: Int, deltaX: Int = 0) -> [String: Any] {
    let source = CGEventSource(stateID: .combinedSessionState)
    let scroll = CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 2,
                         wheel1: Int32(deltaY), wheel2: Int32(deltaX), wheel3: 0)
    if let s = scroll {
        s.post(tap: .cghidEventTap)
    }
    return ["success": true, "delta_y": deltaY, "delta_x": deltaX]
}

// ═══════════════════════════════════════════════════
// MARK: - APP CONTROL (SPEC §6.2.3)
// NSWorkspace + Accessibility API
// ═══════════════════════════════════════════════════

func launchApp(bundleId: String) -> [String: Any] {
    let success = NSWorkspace.shared.launchApplication(
        withBundleIdentifier: bundleId,
        options: [],
        additionalEventParamDescriptor: nil,
        launchIdentifier: nil
    )
    return ["success": success, "bundle_id": bundleId, "action": "launch"]
}

func activateApp(name: String) -> [String: Any] {
    let apps = NSWorkspace.shared.runningApplications.filter {
        $0.localizedName?.lowercased() == name.lowercased()
    }
    if let app = apps.first {
        app.activate()
        return ["success": true, "app": name, "action": "activate"]
    }
    return ["success": false, "error": "App not found: \(name)"]
}

func quitApp(name: String) -> [String: Any] {
    let apps = NSWorkspace.shared.runningApplications.filter {
        $0.localizedName?.lowercased() == name.lowercased()
    }
    if let app = apps.first {
        app.terminate()
        return ["success": true, "app": name, "action": "quit"]
    }
    return ["success": false, "error": "App not found: \(name)"]
}

// ═══════════════════════════════════════════════════
// MARK: - APPLESCRIPT BRIDGE (SPEC §6.2.4)
// ═══════════════════════════════════════════════════

func runAppleScript(_ script: String) -> [String: Any] {
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    task.arguments = ["-e", script]

    let outPipe = Pipe()
    let errPipe = Pipe()
    task.standardOutput = outPipe
    task.standardError = errPipe

    do {
        try task.run()
        task.waitUntilExit()

        let output = String(data: outPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let errorOutput = String(data: errPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        if task.terminationStatus == 0 {
            return ["success": true, "output": output]
        } else {
            return ["success": false, "error": errorOutput, "exit_code": task.terminationStatus]
        }
    } catch {
        return ["success": false, "error": error.localizedDescription]
    }
}

// ═══════════════════════════════════════════════════
// MARK: - SYSTEM CONTROL (SPEC §6.2.5)
// ═══════════════════════════════════════════════════

func setVolume(_ level: Int) -> [String: Any] {
    return runAppleScript("set volume output volume \(max(0, min(100, level)))")
}

func showNotification(title: String, body: String) -> [String: Any] {
    return runAppleScript("display notification \"\(body)\" with title \"\(title)\"")
}

func openURL(_ url: String) -> [String: Any] {
    if let nsurl = URL(string: url) {
        NSWorkspace.shared.open(nsurl)
        return ["success": true, "url": url]
    }
    return ["success": false, "error": "Invalid URL"]
}

// ═══════════════════════════════════════════════════
// MARK: - SENSORY SNAPSHOT (for verification)
// ═══════════════════════════════════════════════════

func captureSnapshot() -> [String: Any] {
    let frontApp = NSWorkspace.shared.frontmostApplication
    let appName = frontApp?.localizedName ?? "unknown"

    var windowTitle = ""
    if let app = frontApp {
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        var focusedWindow: AnyObject?
        AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &focusedWindow)
        if let win = focusedWindow {
            var titleVal: AnyObject?
            AXUIElementCopyAttributeValue(win as! AXUIElement, kAXTitleAttribute as CFString, &titleVal)
            windowTitle = titleVal as? String ?? ""
        }
    }

    let cursorPos = NSEvent.mouseLocation
    let screenHeight = NSScreen.main?.frame.height ?? 0

    return [
        "front_app": appName,
        "window_title": windowTitle,
        "cursor": ["x": Int(cursorPos.x), "y": Int(screenHeight - cursorPos.y)],
        "timestamp": ISO8601DateFormatter().string(from: Date())
    ]
}

// ═══════════════════════════════════════════════════
// MARK: - COMMAND DISPATCHER
// ═══════════════════════════════════════════════════

func handleCommand(_ command: [String: Any]) -> [String: Any] {
    guard let action = command["action"] as? String else {
        return ["success": false, "error": "Missing 'action' field"]
    }

    let params = command["parameters"] as? [String: Any] ?? [:]
    let captureAfter = command["capture_after"] as? Bool ?? true

    var result: [String: Any]

    switch action {
    case "type":
        let text = params["text"] as? String ?? ""
        let speedStr = params["speed"] as? String ?? "instant"
        let speed = TypingSpeed(rawValue: speedStr) ?? .instant
        result = typeText(text, speed: speed)

    case "press":
        let keyCode = params["key_code"] as? Int ?? 0
        let modifiers = params["modifiers"] as? [String] ?? []
        result = pressKey(keyCode: keyCode, modifiers: modifiers)

    case "click":
        let x = params["x"] as? Double ?? 0
        let y = params["y"] as? Double ?? 0
        let button = params["button"] as? String ?? "left"
        result = mouseClick(x: x, y: y, button: button)

    case "double_click":
        let x = params["x"] as? Double ?? 0
        let y = params["y"] as? Double ?? 0
        result = mouseDoubleClick(x: x, y: y)

    case "move":
        let x = params["x"] as? Double ?? 0
        let y = params["y"] as? Double ?? 0
        let duration = params["duration"] as? Double ?? 0
        result = mouseMove(x: x, y: y, duration: duration)

    case "drag":
        let fromX = params["from_x"] as? Double ?? 0
        let fromY = params["from_y"] as? Double ?? 0
        let toX = params["to_x"] as? Double ?? 0
        let toY = params["to_y"] as? Double ?? 0
        let duration = params["duration"] as? Double ?? 0.3
        result = mouseDrag(fromX: fromX, fromY: fromY, toX: toX, toY: toY, duration: duration)

    case "scroll":
        let deltaY = params["delta_y"] as? Int ?? 0
        let deltaX = params["delta_x"] as? Int ?? 0
        result = mouseScroll(deltaY: deltaY, deltaX: deltaX)

    case "launch":
        let bundleId = params["bundle_id"] as? String ?? ""
        result = launchApp(bundleId: bundleId)

    case "activate":
        let name = params["app"] as? String ?? ""
        result = activateApp(name: name)

    case "quit":
        let name = params["app"] as? String ?? ""
        result = quitApp(name: name)

    case "applescript":
        let script = params["script"] as? String ?? ""
        result = runAppleScript(script)

    case "volume":
        let level = params["level"] as? Int ?? 50
        result = setVolume(level)

    case "notify":
        let title = params["title"] as? String ?? ""
        let body = params["body"] as? String ?? ""
        result = showNotification(title: title, body: body)

    case "open_url":
        let url = params["url"] as? String ?? ""
        result = openURL(url)

    case "snapshot":
        result = captureSnapshot()

    default:
        result = ["success": false, "error": "Unknown action: \(action)"]
    }

    if captureAfter && action != "snapshot" {
        usleep(100_000) // 100ms settle time
        result["sensory_snapshot"] = captureSnapshot()
    }

    result["action"] = action
    result["command_id"] = command["id"] as? String ?? ""
    return result
}

// ═══════════════════════════════════════════════════
// MARK: - UNIX SOCKET SERVER
// ═══════════════════════════════════════════════════

class MotorSocketServer {
    private var socketFD: Int32 = -1

    func start() {
        unlink(SOCKET_PATH)
        socketFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard socketFD >= 0 else {
            log("ERROR: Failed to create socket")
            return
        }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = SOCKET_PATH.utf8CString
        withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
            ptr.withMemoryRebound(to: CChar.self, capacity: 104) { dest in
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
            log("ERROR: Failed to bind: \(String(cString: strerror(errno)))")
            return
        }

        Darwin.listen(socketFD, 5)
        log("Motor socket server listening on \(SOCKET_PATH)")

        DispatchQueue.global(qos: .userInteractive).async { [weak self] in
            while true {
                guard let self = self else { break }
                let clientFD = Darwin.accept(self.socketFD, nil, nil)
                if clientFD < 0 { continue }
                self.handleClient(clientFD)
            }
        }
    }

    private func handleClient(_ clientFD: Int32) {
        DispatchQueue.global(qos: .userInteractive).async {
            let handle = FileHandle(fileDescriptor: clientFD, closeOnDealloc: true)
            var buffer = Data()

            while true {
                let chunk = handle.availableData
                if chunk.isEmpty { break }
                buffer.append(chunk)

                while let newlineRange = buffer.range(of: Data("\n".utf8)) {
                    let lineData = buffer.subdata(in: buffer.startIndex..<newlineRange.lowerBound)
                    buffer.removeSubrange(buffer.startIndex...newlineRange.lowerBound)

                    guard let line = String(data: lineData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                          !line.isEmpty,
                          let command = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else {
                        continue
                    }

                    // Execute on main thread for CGEvent access
                    DispatchQueue.main.sync {
                        let result = handleCommand(command)
                        if let data = try? JSONSerialization.data(withJSONObject: result),
                           var str = String(data: data, encoding: .utf8) {
                            str += "\n"
                            handle.write(str.data(using: .utf8)!)
                        }
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════
// MARK: - MAIN
// ═══════════════════════════════════════════════════

log("oneiro-motor starting (v1.0.0)")

let server = MotorSocketServer()
server.start()

log("Motor cortex online — waiting for commands")

RunLoop.current.run()
