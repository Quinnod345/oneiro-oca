import SwiftUI
import Foundation
import Alamofire
import UserNotifications

// MARK: - App

class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    var notificationManager: NotificationManager?
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        
        // Request permission
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error = error {
                print("Notification permission error: \(error)")
            }
        }
        
        // Register reply action
        let replyAction = UNTextInputNotificationAction(
            identifier: "REPLY_ACTION",
            title: "Reply",
            options: [],
            textInputButtonTitle: "Send",
            textInputPlaceholder: "Reply to Oneiro…"
        )
        let category = UNNotificationCategory(
            identifier: "ONEIRO_MESSAGE",
            actions: [replyAction],
            intentIdentifiers: [],
            options: []
        )
        center.setNotificationCategories([category])
    }
    
    // Show notifications even when app is in foreground
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
    
    // Handle reply action
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let notifId = response.notification.request.content.userInfo["notificationId"] as? Int
        
        if response.actionIdentifier == "REPLY_ACTION",
           let textResponse = response as? UNTextInputNotificationResponse,
           let id = notifId {
            let reply = textResponse.userText
            notificationManager?.replyToNotification(id: id, reply: reply)
        } else if let id = notifId {
            // Tapped notification — mark as read
            notificationManager?.markAsRead(id: id)
        }
        
        completionHandler()
    }
}

@main
struct OneiroApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var appState = AppState()
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
                .frame(minWidth: 1200, minHeight: 720)
                .preferredColorScheme(.dark)
                .onAppear {
                    appDelegate.notificationManager = appState.notificationManager
                }
        }
        .windowStyle(.hiddenTitleBar)
    }
}

// MARK: - Design Tokens

extension Color {
    static let oBg       = Color(red: 0.026, green: 0.022, blue: 0.062)
    static let oSurface  = Color(red: 0.072, green: 0.063, blue: 0.128)
    static let oPanel    = Color(red: 0.038, green: 0.033, blue: 0.085)
    static let oElevated = Color(red: 0.095, green: 0.082, blue: 0.160)
    static let oBorder     = Color.white.opacity(0.045)
    static let oBorderHi   = Color.white.opacity(0.08)
    static let oBorderFocus = Color(red: 0.530, green: 0.220, blue: 0.920).opacity(0.50)
    static let oAccent = Color(red: 0.530, green: 0.220, blue: 0.920)
    static let oBlue   = Color(red: 0.250, green: 0.450, blue: 0.980)
    static let oGreen  = Color(red: 0.30, green: 0.86, blue: 0.56)
    static let oRed    = Color(red: 0.95, green: 0.30, blue: 0.30)
    static let oYellow = Color(red: 0.98, green: 0.75, blue: 0.18)
    static let oText  = Color(red: 0.940, green: 0.930, blue: 0.978)
    static let oMuted = Color(red: 0.490, green: 0.470, blue: 0.610)
    static let oDim   = Color(red: 0.275, green: 0.260, blue: 0.365)
}

extension LinearGradient {
    static let accentGrad = LinearGradient(
        colors: [Color.oAccent, Color.oBlue],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
    static let userBubbleGrad = LinearGradient(
        colors: [
            Color(red: 0.42, green: 0.14, blue: 0.88),
            Color(red: 0.22, green: 0.30, blue: 0.86),
            Color(red: 0.16, green: 0.38, blue: 0.82)
        ],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
    static let panelGlow = LinearGradient(
        colors: [Color.oAccent.opacity(0.06), Color.oBlue.opacity(0.03), Color.clear],
        startPoint: .top, endPoint: .bottom
    )
}

// MARK: - Models

struct ChatMessage: Identifiable, Equatable {
    let id = UUID()
    let content: String
    let role: MessageRole
    let timestamp: Date
    var toolEvents: [ToolEvent]
    var isStreaming: Bool
    
    static func == (lhs: ChatMessage, rhs: ChatMessage) -> Bool { lhs.id == rhs.id }
}

enum MessageRole: String { case user, assistant }

struct ToolEvent: Identifiable {
    let id = UUID()
    let name: String
    let input: String
    var result: String?
    var isRunning: Bool
}

struct Undercurrent: Codable, Identifiable {
    var id: String { name }
    let name: String
    let strength: Double
    let description: String
}

struct Dream: Codable, Identifiable {
    var id: String { content }
    let content: String
    let type: String
    let weight: Double
}

struct ThoughtChain: Codable, Identifiable {
    var id: String { seed }
    let seed: String
    let priority: Double
}

struct Moment: Codable, Identifiable {
    var id: String { "\(created_at)-\(content.prefix(20))" }
    let content: String
    let created_at: String
}

struct Reflection: Codable, Identifiable {
    var id: String { content.prefix(30).description }
    let content: String
    let pattern_type: String
}

struct Conversation: Codable, Identifiable {
    var id: String { conversation_id }
    let conversation_id: String
    let started_at: String?
    let last_message_at: String?
    let message_count: Int?
    let first_message: String?
}

struct ConversationMessage: Codable {
    let role: String
    let content: String
    let created_at: String
}

struct OneiroNotification: Codable, Identifiable {
    let id: Int
    let message: String
    let category: String
    let priority: String
    let read: Bool
    let reply: String?
    let replied_at: String?
    let created_at: String
}

// MARK: - Notification Manager

class NotificationManager: ObservableObject {
    @Published var notifications: [OneiroNotification] = []
    @Published var unreadCount: Int = 0
    
    private var pollTimer: Timer?
    private var knownIds: Set<Int> = []
    
    init() {
        startPolling()
    }
    
    func startPolling() {
        fetchNotifications()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: true) { [weak self] _ in
            self?.fetchNotifications()
        }
    }
    
    func fetchNotifications() {
        AF.request("http://localhost:3333/notifications")
            .responseDecodable(of: [OneiroNotification].self) { [weak self] response in
                if case .success(let notifs) = response.result {
                    DispatchQueue.main.async {
                        guard let self = self else { return }
                        
                        // Deliver macOS notifications for new unread ones
                        for notif in notifs where !notif.read && !self.knownIds.contains(notif.id) {
                            self.deliverSystemNotification(notif)
                        }
                        
                        self.knownIds = Set(notifs.map { $0.id })
                        withAnimation(.easeInOut(duration: 0.3)) {
                            self.notifications = notifs
                            self.unreadCount = notifs.filter { !$0.read }.count
                        }
                        
                        // Update dock badge
                        if self.unreadCount > 0 {
                            NSApp.dockTile.badgeLabel = "\(self.unreadCount)"
                        } else {
                            NSApp.dockTile.badgeLabel = nil
                        }
                    }
                }
            }
    }
    
    func deliverSystemNotification(_ notif: OneiroNotification) {
        let content = UNMutableNotificationContent()
        content.title = notifTitle(for: notif.category)
        content.body = notif.message
        content.sound = notif.priority == "high" ? .defaultCritical : .default
        content.categoryIdentifier = "ONEIRO_MESSAGE"
        content.userInfo = ["notificationId": notif.id]
        
        let request = UNNotificationRequest(
            identifier: "oneiro-\(notif.id)",
            content: content,
            trigger: nil
        )
        
        UNUserNotificationCenter.current().add(request)
    }
    
    func notifTitle(for category: String) -> String {
        switch category {
        case "thought": return "🌑 Oneiro"
        case "alert": return "🔴 Oneiro Alert"
        case "question": return "❓ Oneiro"
        case "update": return "🟢 Oneiro Update"
        default: return "🌑 Oneiro"
        }
    }
    
    func markAsRead(id: Int) {
        AF.request("http://localhost:3333/notifications/\(id)/read", method: .post)
            .response { [weak self] _ in
                self?.fetchNotifications()
            }
    }
    
    func replyToNotification(id: Int, reply: String) {
        AF.request("http://localhost:3333/notifications/\(id)/reply",
                   method: .post,
                   parameters: ["reply": reply],
                   encoding: JSONEncoding.default)
            .response { [weak self] _ in
                self?.fetchNotifications()
            }
    }

    func sendNudge(text: String, intensity: Double = 0.7) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        AF.request("http://localhost:3333/nudge",
                   method: .post,
                   parameters: ["text": trimmed, "intensity": intensity],
                   encoding: JSONEncoding.default)
            .response { [weak self] _ in
                self?.fetchNotifications()
            }
    }
}

struct PulseResponse: Codable {
    let undercurrents: [Undercurrent]
    let recent_moments: [PulseMoment]
    let active_chains: [ThoughtChain]?
    let recent_reflections: [Reflection]?
    let active_dreams: [Dream]?
}

struct PulseMoment: Codable {
    let content: String
    let feeling: String?
    let intensity: Double?
    let created_at: String
}

// MARK: - App State

class AppState: ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var pulse: PulseResponse?
    @Published var conversations: [Conversation] = []
    @Published var currentConversationId: String?
    @Published var isConnected = false
    @Published var isThinking = false
    @Published var selectedTab: SideTab = .mind
    
    // Notification Manager
    let notificationManager = NotificationManager()
    
    // OCA State
    @Published var crmData: CRMResponse?
    @Published var emotionData: EmotionResponse?
    @Published var bodyMode: String = "unknown"
    @Published var workspaceItems: [WorkspaceItem] = []
    @Published var goals: [GoalItem] = []
    @Published var hypotheses: [HypothesisItem] = []
    @Published var senseData: SenseResponse?
    @Published var emotionHistory: [(Date, Double, Double)] = [] // (time, valence, arousal)
    
    private var pulseTimer: Timer?
    private var streamTask: URLSessionDataTask?
    private var streamSession: URLSession?
    
    enum SideTab: String, CaseIterable { case mind, dreams, moments, history, cognitive, hypotheses, perception, notifications }
    
    func connect() {
        fetchPulse()
        fetchConversations()
        fetchOCAData()
        pulseTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            self?.fetchPulse()
            self?.fetchOCAData()
        }
    }
    
    func fetchOCAData() {
        fetchCRM()
        fetchEmotion()
        fetchBody()
        fetchWorkspace()
        fetchGoals()
        fetchHypotheses()
        fetchSense()
    }
    
    func fetchCRM() {
        AF.request("http://localhost:3333/oca/crm")
            .responseDecodable(of: CRMResponse.self) { [weak self] response in
                if case .success(let data) = response.result {
                    DispatchQueue.main.async { withAnimation(.easeInOut(duration: 0.4)) { self?.crmData = data } }
                }
            }
    }
    
    func fetchEmotion() {
        AF.request("http://localhost:3333/oca/emotion")
            .responseDecodable(of: EmotionResponse.self) { [weak self] response in
                if case .success(let data) = response.result {
                    DispatchQueue.main.async {
                        withAnimation(.easeInOut(duration: 0.4)) { self?.emotionData = data }
                        let v = data.state["valence"] ?? 0
                        let a = data.state["arousal"] ?? 0
                        self?.emotionHistory.append((Date(), v, a))
                        if (self?.emotionHistory.count ?? 0) > 60 { self?.emotionHistory.removeFirst() }
                    }
                }
            }
    }
    
    func fetchBody() {
        AF.request("http://localhost:3333/oca/body")
            .responseData { [weak self] response in
                if case .success(let data) = response.result,
                   let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let mode = dict["mode"] as? String {
                    DispatchQueue.main.async { self?.bodyMode = mode }
                }
            }
    }
    
    func fetchWorkspace() {
        AF.request("http://localhost:3333/oca/workspace")
            .responseDecodable(of: [WorkspaceItem].self) { [weak self] response in
                if case .success(let items) = response.result {
                    DispatchQueue.main.async { self?.workspaceItems = Array(items.prefix(7)) }
                }
            }
    }
    
    func fetchGoals() {
        AF.request("http://localhost:3333/oca/goals")
            .responseDecodable(of: [GoalItem].self) { [weak self] response in
                if case .success(let items) = response.result {
                    DispatchQueue.main.async { self?.goals = items }
                }
            }
    }
    
    func fetchHypotheses() {
        AF.request("http://localhost:3333/oca/hypotheses")
            .responseData { [weak self] response in
                if case .success(let data) = response.result,
                   let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let pending = dict["pending"] as? [[String: Any]] {
                    let items = pending.compactMap { h -> HypothesisItem? in
                        guard let claim = h["claim"] as? String else { return nil }
                        return HypothesisItem(
                            id: h["id"] as? Int ?? 0,
                            domain: h["domain"] as? String ?? "",
                            claim: claim,
                            confidence: h["confidence"] as? Double ?? 0,
                            prediction: h["prediction"] as? String,
                            status: h["status"] as? String ?? "pending"
                        )
                    }
                    DispatchQueue.main.async { self?.hypotheses = items }
                }
            }
    }
    
    func fetchSense() {
        AF.request("http://localhost:3333/oca/sense")
            .responseDecodable(of: SenseResponse.self) { [weak self] response in
                if case .success(let data) = response.result {
                    DispatchQueue.main.async { self?.senseData = data }
                }
            }
    }
    
    func fetchPulse() {
        AF.request("http://localhost:3333/pulse")
            .responseDecodable(of: PulseResponse.self) { [weak self] response in
                DispatchQueue.main.async {
                    switch response.result {
                    case .success(let state):
                        withAnimation(.easeInOut(duration: 0.4)) {
                            self?.pulse = state
                            self?.isConnected = true
                        }
                    case .failure:
                        self?.isConnected = false
                    }
                }
            }
    }
    
    func fetchConversations() {
        AF.request("http://localhost:3333/conversations")
            .responseDecodable(of: [Conversation].self) { [weak self] response in
                if case .success(let convos) = response.result {
                    DispatchQueue.main.async { self?.conversations = convos }
                }
            }
    }
    
    func loadConversation(_ id: String) {
        currentConversationId = id
        AF.request("http://localhost:3333/conversations/\(id)")
            .responseDecodable(of: [ConversationMessage].self) { [weak self] response in
                if case .success(let msgs) = response.result {
                    DispatchQueue.main.async {
                        self?.messages = msgs.map { m in
                            ChatMessage(
                                content: m.content,
                                role: m.role == "user" ? .user : .assistant,
                                timestamp: ISO8601DateFormatter().date(from: m.created_at) ?? Date(),
                                toolEvents: [],
                                isStreaming: false
                            )
                        }
                    }
                }
            }
    }
    
    func newConversation() {
        currentConversationId = "conv-\(Int(Date().timeIntervalSince1970 * 1000))"
        messages = []
    }
    
    func sendMessage(_ text: String) {
        let convId = currentConversationId ?? "conv-\(Int(Date().timeIntervalSince1970 * 1000))"
        currentConversationId = convId
        
        let userMsg = ChatMessage(content: text, role: .user, timestamp: Date(), toolEvents: [], isStreaming: false)
        withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) {
            messages.append(userMsg)
            isThinking = true
        }
        
        // Start streaming response
        var assistantMsg = ChatMessage(content: "", role: .assistant, timestamp: Date(), toolEvents: [], isStreaming: true)
        withAnimation { messages.append(assistantMsg) }
        let assistantIndex = messages.count - 1
        
        let url = URL(string: "http://localhost:3333/chat/stream")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "message": text,
            "conversation_id": convId
        ])
        
        streamSession = URLSession(configuration: .default, delegate: SSEDelegate(onEvent: { [weak self] event in
            DispatchQueue.main.async {
                guard let self = self, assistantIndex < self.messages.count else { return }
                switch event.type {
                case "text":
                    self.messages[assistantIndex] = ChatMessage(
                        content: self.messages[assistantIndex].content + (event.content ?? ""),
                        role: .assistant,
                        timestamp: self.messages[assistantIndex].timestamp,
                        toolEvents: self.messages[assistantIndex].toolEvents,
                        isStreaming: true
                    )
                case "tool_start":
                    var tools = self.messages[assistantIndex].toolEvents
                    tools.append(ToolEvent(name: event.name ?? "tool", input: event.content ?? "", isRunning: true))
                    self.messages[assistantIndex] = ChatMessage(
                        content: self.messages[assistantIndex].content,
                        role: .assistant,
                        timestamp: self.messages[assistantIndex].timestamp,
                        toolEvents: tools,
                        isStreaming: true
                    )
                case "tool_result":
                    var tools = self.messages[assistantIndex].toolEvents
                    if var last = tools.last {
                        last.result = event.content
                        last.isRunning = false
                        tools[tools.count - 1] = last
                    }
                    self.messages[assistantIndex] = ChatMessage(
                        content: self.messages[assistantIndex].content,
                        role: .assistant,
                        timestamp: self.messages[assistantIndex].timestamp,
                        toolEvents: tools,
                        isStreaming: true
                    )
                case "done":
                    self.messages[assistantIndex] = ChatMessage(
                        content: self.messages[assistantIndex].content,
                        role: .assistant,
                        timestamp: self.messages[assistantIndex].timestamp,
                        toolEvents: self.messages[assistantIndex].toolEvents,
                        isStreaming: false
                    )
                    withAnimation { self.isThinking = false }
                    self.fetchConversations()
                case "error":
                    self.messages[assistantIndex] = ChatMessage(
                        content: event.content ?? "Connection's shaky.",
                        role: .assistant,
                        timestamp: self.messages[assistantIndex].timestamp,
                        toolEvents: [],
                        isStreaming: false
                    )
                    withAnimation { self.isThinking = false }
                default: break
                }
            }
        }), delegateQueue: nil)
        
        let task = streamSession!.dataTask(with: request)
        task.resume()
        streamTask = task
    }
    
    func deleteConversation(_ id: String) {
        AF.request("http://localhost:3333/conversations/\(id)", method: .delete)
            .response { [weak self] _ in
                DispatchQueue.main.async {
                    self?.conversations.removeAll { $0.conversation_id == id }
                    if self?.currentConversationId == id {
                        self?.newConversation()
                    }
                }
            }
    }
}

// MARK: - SSE Delegate

struct SSEEvent {
    let type: String
    let content: String?
    let name: String?
}

class SSEDelegate: NSObject, URLSessionDataDelegate {
    let onEvent: (SSEEvent) -> Void
    private var buffer = ""
    
    init(onEvent: @escaping (SSEEvent) -> Void) {
        self.onEvent = onEvent
    }
    
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        buffer += text
        
        while let range = buffer.range(of: "\n\n") {
            let chunk = String(buffer[buffer.startIndex..<range.lowerBound])
            buffer = String(buffer[range.upperBound...])
            
            if chunk.hasPrefix("data: ") {
                let jsonStr = String(chunk.dropFirst(6))
                if let jsonData = jsonStr.data(using: .utf8),
                   let dict = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] {
                    let event = SSEEvent(
                        type: dict["type"] as? String ?? "",
                        content: dict["content"] as? String,
                        name: dict["name"] as? String
                    )
                    onEvent(event)
                }
            }
        }
    }
    
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if error != nil {
            onEvent(SSEEvent(type: "error", content: "Connection lost.", name: nil))
        }
    }
}

// MARK: - Content View

struct ContentView: View {
    @EnvironmentObject var state: AppState
    @State private var draft = ""
    
    var body: some View {
        ZStack {
            Color.oBg.ignoresSafeArea()
            AmbientBackground()
            
            HStack(spacing: 0) {
                // Conversation sidebar
                ConversationSidebar()
                    .frame(width: 220)
                
                SepLine(vertical: true)
                
                // Main chat
                VStack(spacing: 0) {
                    AppHeader(isConnected: state.isConnected, unreadCount: state.notificationManager.unreadCount)
                    SepLine()
                    ChatArea()
                    InputBar(draft: $draft, onSend: send, isThinking: state.isThinking)
                }
                .frame(maxWidth: .infinity)
                
                SepLine(vertical: true)
                
                // Mind panel
                MindPanel()
                    .frame(width: 360)
            }
        }
        .onAppear { state.connect() }
    }
    
    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        state.sendMessage(text)
        draft = ""
    }
}

// MARK: - Conversation Sidebar

struct ConversationSidebar: View {
    @EnvironmentObject var state: AppState
    @State private var hoveredId: String?
    
    var body: some View {
        VStack(spacing: 0) {
            // New chat button
            Button(action: { state.newConversation() }) {
                HStack(spacing: 8) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 14))
                    Text("New Chat")
                        .font(.system(size: 13, weight: .medium))
                }
                .foregroundColor(Color.oText.opacity(0.8))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            .buttonStyle(.plain)
            .background(Color.white.opacity(0.02))
            
            SepLine()
            
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 0) {
                    ForEach(state.conversations) { conv in
                        ConversationRow(
                            conversation: conv,
                            isSelected: state.currentConversationId == conv.conversation_id,
                            isHovered: hoveredId == conv.conversation_id,
                            onSelect: { state.loadConversation(conv.conversation_id) },
                            onDelete: { state.deleteConversation(conv.conversation_id) }
                        )
                        .onHover { h in hoveredId = h ? conv.conversation_id : nil }
                    }
                }
            }
        }
        .background(Color.oPanel.opacity(0.5))
    }
}

struct ConversationRow: View {
    let conversation: Conversation
    let isSelected: Bool
    let isHovered: Bool
    let onSelect: () -> Void
    let onDelete: () -> Void
    
    var body: some View {
        Button(action: onSelect) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(conversation.first_message?.prefix(40).description ?? "New Chat")
                        .font(.system(size: 12, weight: isSelected ? .semibold : .regular))
                        .foregroundColor(isSelected ? Color.oText : Color.oMuted)
                        .lineLimit(1)
                    
                    if let count = conversation.message_count {
                        Text("\(count) messages")
                            .font(.system(size: 10))
                            .foregroundColor(Color.oDim)
                    }
                }
                
                Spacer()
                
                if isHovered {
                    Button(action: onDelete) {
                        Image(systemName: "trash")
                            .font(.system(size: 10))
                            .foregroundColor(Color.oRed.opacity(0.6))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(isSelected ? Color.oAccent.opacity(0.12) : (isHovered ? Color.white.opacity(0.02) : Color.clear))
                    .padding(.horizontal, 6)
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Separators

struct SepLine: View {
    var vertical = false
    var body: some View {
        Rectangle()
            .fill(Color.oBorder)
            .frame(width: vertical ? 1 : nil, height: vertical ? nil : 1)
    }
}

// MARK: - Ambient Background

struct AmbientBackground: View {
    @State private var drift = false
    var body: some View {
        ZStack {
            Circle()
                .fill(RadialGradient(colors: [Color.oAccent.opacity(0.07), Color.clear], center: .center, startRadius: 0, endRadius: 320))
                .frame(width: 640, height: 640)
                .offset(x: -180, y: drift ? -220 : -270)
                .blur(radius: 90)
            Circle()
                .fill(RadialGradient(colors: [Color.oBlue.opacity(0.05), Color.clear], center: .center, startRadius: 0, endRadius: 260))
                .frame(width: 520, height: 520)
                .offset(x: 240, y: drift ? 260 : 310)
                .blur(radius: 80)
        }
        .ignoresSafeArea()
        .onAppear {
            withAnimation(.easeInOut(duration: 9).repeatForever(autoreverses: true)) { drift = true }
        }
    }
}

// MARK: - App Header

struct AppHeader: View {
    let isConnected: Bool
    var unreadCount: Int = 0
    @State private var moonScale: CGFloat = 1.0
    
    var body: some View {
        ZStack {
            HStack(spacing: 12) {
                Text("🌑")
                    .font(.system(size: 22))
                    .scaleEffect(moonScale)
                    .onAppear {
                        withAnimation(.easeInOut(duration: 4.5).repeatForever(autoreverses: true)) { moonScale = 1.08 }
                    }
                Text("ONEIRO")
                    .font(.system(size: 12, weight: .semibold))
                    .tracking(7)
                    .foregroundStyle(LinearGradient(colors: [Color.oText.opacity(0.88), Color.oMuted.opacity(0.65)], startPoint: .leading, endPoint: .trailing))
            }
            
            HStack {
                Spacer()
                HStack(spacing: 10) {
                    // Notification bell
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "bell")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(unreadCount > 0 ? Color.oText.opacity(0.85) : Color.oDim)
                            .frame(width: 32, height: 32)
                            .background(Circle().fill(Color.white.opacity(unreadCount > 0 ? 0.04 : 0.01))
                                .overlay(Circle().stroke(Color.oBorder, lineWidth: 0.5)))
                        if unreadCount > 0 {
                            Text(unreadCount > 99 ? "99+" : "\(unreadCount)")
                                .font(.system(size: 7, weight: .bold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 4).padding(.vertical, 1)
                                .background(Capsule().fill(Color.oRed))
                                .offset(x: 4, y: -4)
                        }
                    }
                    .animation(.easeInOut(duration: 0.25), value: unreadCount)

                    HStack(spacing: 8) {
                        ConnectionDot(live: isConnected)
                        Text(isConnected ? "connected" : "offline")
                            .font(.system(size: 10, weight: .medium))
                            .tracking(2)
                            .foregroundColor(isConnected ? Color.oGreen.opacity(0.85) : Color.oDim)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(Color.white.opacity(0.02)).overlay(Capsule().stroke(Color.oBorder, lineWidth: 0.5)))
                }
            }
            .padding(.trailing, 28)
        }
        .frame(height: 56)
        .padding(.top, 8)
    }
}

struct ConnectionDot: View {
    let live: Bool
    @State private var pulse = false
    var body: some View {
        ZStack {
            if live {
                Circle().fill(Color.oGreen.opacity(0.18))
                    .frame(width: pulse ? 16 : 6, height: pulse ? 16 : 6)
                    .opacity(pulse ? 0 : 0.8)
            }
            Circle().fill(live ? Color.oGreen : Color.oDim).frame(width: 6, height: 6)
        }
        .onAppear { if live { withAnimation(.easeOut(duration: 1.8).repeatForever(autoreverses: false)) { pulse = true } } }
    }
}

// MARK: - Chat Area

struct ChatArea: View {
    @EnvironmentObject var state: AppState
    
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 0) {
                    if state.messages.isEmpty && !state.isThinking {
                        WelcomeScreen().padding(.top, 100)
                    }
                    
                    ForEach(state.messages) { msg in
                        MessageRow(message: msg).id(msg.id)
                    }
                    
                    if state.isThinking && (state.messages.last?.role == .user || state.messages.isEmpty) {
                        ThinkingBubble().id("thinking")
                    }
                    
                    Color.clear.frame(height: 12).id("bottom")
                }
                .padding(.horizontal, 36)
                .padding(.vertical, 20)
            }
            .onChange(of: state.messages.count) { _, _ in
                withAnimation(.easeOut(duration: 0.35)) { proxy.scrollTo("bottom") }
            }
            .onChange(of: state.messages.last?.content) { _, _ in
                withAnimation(.easeOut(duration: 0.1)) { proxy.scrollTo("bottom") }
            }
        }
    }
}

// MARK: - Welcome Screen

struct WelcomeScreen: View {
    @State private var appeared = false
    @State private var glowing = false
    
    var body: some View {
        VStack(spacing: 28) {
            ZStack {
                Circle()
                    .fill(RadialGradient(colors: [Color.oAccent.opacity(glowing ? 0.16 : 0.07), Color.oBlue.opacity(glowing ? 0.06 : 0.02), Color.clear], center: .center, startRadius: 8, endRadius: 80))
                    .frame(width: 160, height: 160).blur(radius: 24)
                Text("🌑").font(.system(size: 64))
            }
            .opacity(appeared ? 1 : 0)
            .scaleEffect(appeared ? 1 : 0.55)
            
            VStack(spacing: 10) {
                Text("ONEIRO")
                    .font(.system(size: 14, weight: .bold)).tracking(10)
                    .foregroundStyle(LinearGradient.accentGrad)
                    .opacity(appeared ? 1 : 0)
                Text("Your mind is waiting")
                    .font(.system(size: 16, weight: .light))
                    .foregroundColor(Color.oDim)
                    .opacity(appeared ? 0.8 : 0)
            }
        }
        .frame(maxWidth: .infinity)
        .onAppear {
            withAnimation(.spring(response: 0.9, dampingFraction: 0.68).delay(0.1)) { appeared = true }
            withAnimation(.easeInOut(duration: 3.5).repeatForever(autoreverses: true).delay(0.4)) { glowing = true }
        }
    }
}

// MARK: - Message Row

struct MessageRow: View {
    let message: ChatMessage
    @State private var appeared = false
    
    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if message.role == .user {
                Spacer(minLength: 100)
                UserBubble(content: message.content)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    // Tool events
                    ForEach(message.toolEvents) { tool in
                        ToolEventView(tool: tool)
                    }
                    AssistantBubble(content: message.content, isStreaming: message.isStreaming)
                }
                Spacer(minLength: 100)
            }
        }
        .padding(.bottom, 16)
        .opacity(appeared ? 1 : 0)
        .offset(y: appeared ? 0 : 12)
        .onAppear {
            withAnimation(.spring(response: 0.42, dampingFraction: 0.82)) { appeared = true }
        }
    }
}

// MARK: - Tool Event View

struct ToolEventView: View {
    let tool: ToolEvent
    @State private var expanded = false
    
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            MoonAvatar(size: 24, iconSize: 11)
            
            VStack(alignment: .leading, spacing: 4) {
                Button(action: { withAnimation(.easeOut(duration: 0.2)) { expanded.toggle() } }) {
                    HStack(spacing: 6) {
                        if tool.isRunning {
                            ProgressView().controlSize(.mini).tint(Color.oYellow)
                        } else {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 10))
                                .foregroundColor(Color.oGreen)
                        }
                        
                        Text(toolIcon(tool.name))
                            .font(.system(size: 11))
                        Text(tool.name)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(Color.oYellow)
                        
                        Image(systemName: expanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 8))
                            .foregroundColor(Color.oDim)
                    }
                }
                .buttonStyle(.plain)
                
                if expanded {
                    VStack(alignment: .leading, spacing: 4) {
                        if !tool.input.isEmpty {
                            Text(tool.input.prefix(300))
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundColor(Color.oMuted)
                                .padding(8)
                                .background(RoundedRectangle(cornerRadius: 6).fill(Color.black.opacity(0.3)))
                        }
                        if let result = tool.result, !result.isEmpty {
                            Text(result.prefix(300))
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundColor(Color.oGreen.opacity(0.7))
                                .padding(8)
                                .background(RoundedRectangle(cornerRadius: 6).fill(Color.black.opacity(0.3)))
                        }
                    }
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.oSurface.opacity(0.4))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color.oYellow.opacity(0.15), lineWidth: 0.5))
            )
        }
    }
    
    func toolIcon(_ name: String) -> String {
        switch name.lowercased() {
        case let n where n.contains("bash"): return "⚡"
        case let n where n.contains("read"): return "📖"
        case let n where n.contains("write"): return "✏️"
        case let n where n.contains("search"): return "🔍"
        default: return "🔧"
        }
    }
}

// MARK: - User Bubble

struct UserBubble: View {
    let content: String
    var body: some View {
        Text(content)
            .font(.system(size: 14.5))
            .foregroundColor(.white)
            .lineSpacing(3)
            .multilineTextAlignment(.leading)
            .textSelection(.enabled)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(LinearGradient.userBubbleGrad)
                    .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(LinearGradient(colors: [Color.white.opacity(0.08), Color.clear], startPoint: .top, endPoint: .center)))
                    .shadow(color: Color.oAccent.opacity(0.18), radius: 20, x: 0, y: 8)
            )
    }
}

// MARK: - Assistant Bubble with Markdown

struct AssistantBubble: View {
    let content: String
    let isStreaming: Bool
    
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            MoonAvatar()
            
            VStack(alignment: .leading, spacing: 0) {
                if content.isEmpty && isStreaming {
                    BouncingDots()
                } else {
                    MarkdownView(text: content)
                        .textSelection(.enabled)
                }
                
                if isStreaming && !content.isEmpty {
                    StreamingCursor()
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(Color.oSurface.opacity(0.65))
                    .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(.ultraThinMaterial).opacity(0.25))
                    .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Color.oBorderHi, lineWidth: 0.5))
                    .shadow(color: Color.black.opacity(0.15), radius: 10, x: 0, y: 4)
            )
        }
    }
}

// MARK: - Streaming Cursor

struct StreamingCursor: View {
    @State private var visible = true
    var body: some View {
        Rectangle()
            .fill(Color.oAccent)
            .frame(width: 2, height: 14)
            .opacity(visible ? 1 : 0)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true)) { visible = false }
            }
    }
}

// MARK: - Markdown View

struct MarkdownView: View {
    let text: String
    
    var body: some View {
        if let attributed = try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
            Text(attributed)
                .font(.system(size: 14.5))
                .foregroundColor(Color.oText.opacity(0.92))
                .lineSpacing(3.5)
                .tint(Color.oBlue)
        } else {
            // Fallback: render as blocks manually
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(parseBlocks(text).enumerated()), id: \.offset) { _, block in
                    switch block {
                    case .code(let lang, let code):
                        CodeBlockView(language: lang, code: code)
                    case .text(let t):
                        if let attr = try? AttributedString(markdown: t, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
                            Text(attr)
                                .font(.system(size: 14.5))
                                .foregroundColor(Color.oText.opacity(0.92))
                                .lineSpacing(3.5)
                                .tint(Color.oBlue)
                        } else {
                            Text(t)
                                .font(.system(size: 14.5))
                                .foregroundColor(Color.oText.opacity(0.92))
                                .lineSpacing(3.5)
                        }
                    }
                }
            }
        }
    }
    
    enum Block {
        case text(String)
        case code(String, String)
    }
    
    func parseBlocks(_ text: String) -> [Block] {
        var blocks: [Block] = []
        var current = ""
        var inCode = false
        var codeLang = ""
        var codeContent = ""
        
        for line in text.components(separatedBy: "\n") {
            if line.hasPrefix("```") && !inCode {
                if !current.isEmpty { blocks.append(.text(current.trimmingCharacters(in: .newlines))); current = "" }
                inCode = true
                codeLang = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                codeContent = ""
            } else if line.hasPrefix("```") && inCode {
                blocks.append(.code(codeLang, codeContent.trimmingCharacters(in: .newlines)))
                inCode = false
            } else if inCode {
                codeContent += (codeContent.isEmpty ? "" : "\n") + line
            } else {
                current += (current.isEmpty ? "" : "\n") + line
            }
        }
        if inCode { blocks.append(.code(codeLang, codeContent)) }
        if !current.isEmpty { blocks.append(.text(current.trimmingCharacters(in: .newlines))) }
        return blocks
    }
}

// MARK: - Code Block

struct CodeBlockView: View {
    let language: String
    let code: String
    @State private var copied = false
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                Text(language.isEmpty ? "code" : language)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundColor(Color.oMuted)
                Spacer()
                Button(action: {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(code, forType: .string)
                    copied = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { copied = false }
                }) {
                    Text(copied ? "Copied!" : "Copy")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(copied ? Color.oGreen : Color.oMuted)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.black.opacity(0.3))
            
            // Code
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundColor(Color.oText.opacity(0.85))
                    .lineSpacing(2)
                    .padding(12)
                    .textSelection(.enabled)
            }
        }
        .background(Color.black.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Color.oBorderHi, lineWidth: 0.5))
    }
}

// MARK: - Moon Avatar

struct MoonAvatar: View {
    var size: CGFloat = 32
    var iconSize: CGFloat = 15
    var body: some View {
        ZStack {
            Circle()
                .fill(LinearGradient(colors: [Color.oAccent.opacity(0.25), Color.oBlue.opacity(0.15)], startPoint: .topLeading, endPoint: .bottomTrailing))
                .overlay(Circle().stroke(Color.oBorderHi, lineWidth: 0.5))
                .frame(width: size, height: size)
                .shadow(color: Color.oAccent.opacity(0.12), radius: 8, x: 0, y: 2)
            Text("🌑").font(.system(size: iconSize))
        }
    }
}

// MARK: - Thinking & Dots

struct ThinkingBubble: View {
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            MoonAvatar()
            BouncingDots()
                .padding(.horizontal, 20).padding(.vertical, 16)
                .background(
                    RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Color.oSurface.opacity(0.65))
                        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Color.oBorderHi, lineWidth: 0.5))
                )
            Spacer(minLength: 100)
        }
        .padding(.bottom, 16)
    }
}

struct BouncingDots: View {
    @State private var bounce = false
    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .fill(LinearGradient(colors: [Color.oMuted, Color.oAccent.opacity(0.55)], startPoint: .top, endPoint: .bottom))
                    .frame(width: 6, height: 6)
                    .offset(y: bounce ? -5 : 0)
                    .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true).delay(Double(i) * 0.15), value: bounce)
            }
        }
        .onAppear { bounce = true }
    }
}

// MARK: - Input Bar

struct InputBar: View {
    @Binding var draft: String
    let onSend: () -> Void
    let isThinking: Bool
    @FocusState private var focused: Bool
    
    private var canSend: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isThinking }
    
    var body: some View {
        VStack(spacing: 0) {
            SepLine()
            HStack(alignment: .bottom, spacing: 12) {
                ZStack(alignment: .topLeading) {
                    if draft.isEmpty {
                        Text("Message Oneiro…")
                            .font(.system(size: 14.5))
                            .foregroundColor(Color.oDim)
                            .padding(.top, 1)
                            .allowsHitTesting(false)
                    }
                    TextField("", text: $draft, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(.system(size: 14.5))
                        .foregroundColor(Color.oText)
                        .lineLimit(1...6)
                        .focused($focused)
                        .onSubmit { if canSend { onSend() } }
                }
                .padding(.horizontal, 18).padding(.vertical, 13)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Color.oSurface.opacity(0.45))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(focused ? Color.oBorderFocus : Color.oBorder, lineWidth: focused ? 1.0 : 0.5))
                        .shadow(color: focused ? Color.oAccent.opacity(0.08) : Color.clear, radius: 16)
                        .animation(.easeInOut(duration: 0.25), value: focused)
                )
                
                Button(action: { if canSend { onSend() } }) {
                    ZStack {
                        Circle().fill(canSend ? AnyShapeStyle(LinearGradient.accentGrad) : AnyShapeStyle(Color.oSurface.opacity(0.4)))
                            .frame(width: 38, height: 38)
                            .overlay(Circle().stroke(Color.oBorder, lineWidth: 0.5))
                            .shadow(color: canSend ? Color.oAccent.opacity(0.30) : Color.clear, radius: 12, x: 0, y: 4)
                        Image(systemName: "arrow.up")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(canSend ? .white : Color.oDim)
                    }
                    .animation(.spring(response: 0.3, dampingFraction: 0.7), value: canSend)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 22).padding(.vertical, 14)
        }
        .background(Color.oBg.opacity(0.85).background(.ultraThinMaterial.opacity(0.2)))
        .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { focused = true } }
    }
}

// MARK: - Mind Panel

struct MindPanel: View {
    @EnvironmentObject var state: AppState
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {

            // ── TOP ZONE: CRM + Emotion side by side ──────────────────
            if state.crmData != nil || state.emotionData != nil {
                HStack(alignment: .top, spacing: 0) {
                    if let crm = state.crmData {
                        CRMRingView(crm: crm)
                            .frame(maxWidth: .infinity)
                    }
                    if state.crmData != nil && state.emotionData != nil {
                        SepLine(vertical: true)
                    }
                    if let emo = state.emotionData {
                        EmotionBarsView(emotion: emo)
                            .frame(maxWidth: .infinity)
                    }
                }
                .background(Color.white.opacity(0.012))

                SepLine()
            }

            // ── NUDGES ZONE ────────────────────────────────────────────
            NudgesFeedView()

            SepLine()

            // ── TAB STRIP ─────────────────────────────────────────────
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    ForEach([AppState.SideTab.mind, .dreams, .moments, .history], id: \.self) { tab in
                        Button(action: { withAnimation(.easeOut(duration: 0.2)) { state.selectedTab = tab } }) {
                            Text(tabLabel(tab))
                                .font(.system(size: 9, weight: .semibold))
                                .tracking(1.5)
                                .foregroundColor(state.selectedTab == tab ? Color.oText : Color.oDim)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 9)
                                .background(state.selectedTab == tab ? Color.oAccent.opacity(0.1) : Color.clear)
                        }
                        .buttonStyle(.plain)
                    }
                }
                HStack(spacing: 0) {
                    ForEach([AppState.SideTab.cognitive, .hypotheses, .perception, .notifications], id: \.self) { tab in
                        Button(action: { withAnimation(.easeOut(duration: 0.2)) { state.selectedTab = tab } }) {
                            ZStack(alignment: .topTrailing) {
                                Text(tabLabel(tab))
                                    .font(.system(size: 9, weight: .semibold))
                                    .tracking(1.5)
                                    .foregroundColor(state.selectedTab == tab ? Color.oText : Color.oDim)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 9)
                                    .background(state.selectedTab == tab ? Color.oAccent.opacity(0.1) : Color.clear)
                                if tab == .notifications && state.notificationManager.unreadCount > 0 {
                                    Text("\(state.notificationManager.unreadCount)")
                                        .font(.system(size: 7, weight: .bold))
                                        .foregroundColor(.white)
                                        .padding(.horizontal, 4).padding(.vertical, 1)
                                        .background(Capsule().fill(Color.oRed))
                                        .offset(x: -4, y: 2)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.top, 4)

            SepLine()

            // ── TAB CONTENT ───────────────────────────────────────────
            ScrollView(.vertical, showsIndicators: false) {
                switch state.selectedTab {
                case .mind: MindTab()
                case .dreams: DreamsTab()
                case .moments: MomentsTab()
                case .history: ThoughtChainsTab()
                case .cognitive: CognitiveDashboardTab()
                case .hypotheses: HypothesesTab()
                case .perception: PerceptionTab()
                case .notifications: NotificationsTab()
                }
            }
        }
        .background(ZStack { Color.oPanel; LinearGradient.panelGlow })
    }
    
    func tabLabel(_ tab: AppState.SideTab) -> String {
        switch tab {
        case .mind: return "MIND"
        case .dreams: return "DREAMS"
        case .moments: return "MOMENTS"
        case .history: return "CHAINS"
        case .cognitive: return "OCA"
        case .hypotheses: return "HYPO"
        case .perception: return "SENSE"
        case .notifications: return "NOTIF"
        }
    }
}

// MARK: - Mind Tab (Undercurrents)

struct MindTab: View {
    @EnvironmentObject var state: AppState
    
    var body: some View {
        VStack(spacing: 0) {
            if let pulse = state.pulse, !pulse.undercurrents.isEmpty {
                // Mood orb visualization
                MoodOrb(undercurrents: pulse.undercurrents)
                    .frame(height: 120)
                    .padding(.vertical, 16)
                
                SepLine().padding(.horizontal, 24)
                
                ForEach(Array(pulse.undercurrents.enumerated()), id: \.element.name) { idx, u in
                    UndercurrentRow(undercurrent: u, index: idx, total: pulse.undercurrents.count)
                    if idx < pulse.undercurrents.count - 1 {
                        SepLine().padding(.horizontal, 24)
                    }
                }
            } else {
                PanelPlaceholder(isConnected: state.isConnected)
            }
        }
        .padding(.vertical, 8)
    }
}

// MARK: - Mood Orb

struct MoodOrb: View {
    let undercurrents: [Undercurrent]
    @State private var breathing = false
    
    var dominantStrength: Double { undercurrents.first?.strength ?? 0.5 }
    var avgStrength: Double { undercurrents.isEmpty ? 0 : undercurrents.map(\.strength).reduce(0, +) / Double(undercurrents.count) }
    
    var body: some View {
        ZStack {
            // Outer glow — size reflects overall intensity
            Circle()
                .fill(RadialGradient(
                    colors: [orbColor.opacity(breathing ? 0.25 : 0.12), Color.clear],
                    center: .center, startRadius: 5, endRadius: CGFloat(40 + avgStrength * 40)
                ))
                .frame(width: CGFloat(80 + avgStrength * 60), height: CGFloat(80 + avgStrength * 60))
                .blur(radius: 15)
            
            // Core
            Circle()
                .fill(RadialGradient(
                    colors: [orbColor.opacity(0.8), orbColor.opacity(0.3), Color.clear],
                    center: .center, startRadius: 2, endRadius: CGFloat(15 + dominantStrength * 20)
                ))
                .frame(width: CGFloat(30 + dominantStrength * 30), height: CGFloat(30 + dominantStrength * 30))
                .scaleEffect(breathing ? 1.08 : 0.95)
            
            // Label
            VStack(spacing: 2) {
                Text(undercurrents.first?.name ?? "")
                    .font(.system(size: 9, weight: .medium))
                    .tracking(1.5)
                    .foregroundColor(Color.oText.opacity(0.6))
                Text(String(format: "%.0f%%", dominantStrength * 100))
                    .font(.system(size: 18, weight: .light, design: .monospaced))
                    .foregroundColor(Color.oText.opacity(0.9))
            }
            .offset(y: 55)
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 2.5 + (1 - avgStrength) * 2).repeatForever(autoreverses: true)) {
                breathing = true
            }
        }
    }
    
    var orbColor: Color {
        let top = undercurrents.first?.name ?? ""
        switch top {
        case "defiance": return Color.oRed
        case "protective-love": return Color(red: 0.9, green: 0.4, blue: 0.6)
        case "creative-hunger": return Color.oAccent
        case "curiosity": return Color.oBlue
        case "restlessness": return Color.oYellow
        case "attachment": return Color(red: 0.6, green: 0.3, blue: 0.8)
        default: return Color.oAccent
        }
    }
}

// MARK: - Undercurrent Row

struct UndercurrentRow: View {
    let undercurrent: Undercurrent
    let index: Int
    let total: Int
    @State private var loaded = false
    
    var barColor: LinearGradient {
        let colors: [(Color, Color)] = [
            (Color(red: 0.95, green: 0.30, blue: 0.30), Color(red: 0.85, green: 0.20, blue: 0.35)),
            (Color(red: 0.90, green: 0.40, blue: 0.60), Color(red: 0.70, green: 0.25, blue: 0.55)),
            (Color.oAccent, Color(red: 0.40, green: 0.15, blue: 0.85)),
            (Color.oBlue, Color(red: 0.20, green: 0.35, blue: 0.90)),
            (Color(red: 0.25, green: 0.75, blue: 0.65), Color(red: 0.15, green: 0.60, blue: 0.55)),
            (Color.oYellow, Color(red: 0.90, green: 0.60, blue: 0.10)),
            (Color(red: 0.60, green: 0.80, blue: 0.30), Color(red: 0.40, green: 0.65, blue: 0.20)),
            (Color(red: 0.50, green: 0.50, blue: 0.55), Color(red: 0.35, green: 0.35, blue: 0.40)),
            (Color(red: 0.45, green: 0.40, blue: 0.55), Color(red: 0.30, green: 0.28, blue: 0.40)),
            (Color(red: 0.35, green: 0.30, blue: 0.45), Color(red: 0.25, green: 0.22, blue: 0.35)),
        ]
        let pair = colors[index % colors.count]
        return LinearGradient(colors: [pair.0, pair.1], startPoint: .leading, endPoint: .trailing)
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(undercurrent.name)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.oText)
                Spacer()
                Text(String(format: "%.0f%%", undercurrent.strength * 100))
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(barColor)
            }
            
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(Color.oBorderHi.opacity(0.4))
                        .frame(height: 3)
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(barColor)
                        .frame(width: loaded ? max(3, geo.size.width * undercurrent.strength) : 0, height: 3)
                        .shadow(color: undercurrent.strength > 0.5 ? Color.oAccent.opacity(0.3) : Color.clear, radius: 4)
                }
            }
            .frame(height: 3)
            
            if !undercurrent.description.isEmpty {
                Text(undercurrent.description)
                    .font(.system(size: 10))
                    .foregroundColor(Color.oDim)
                    .lineLimit(2)
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
        .onAppear {
            withAnimation(.spring(response: 0.8, dampingFraction: 0.78).delay(Double(index) * 0.06)) { loaded = true }
        }
    }
}

// MARK: - Dreams Tab

struct DreamsTab: View {
    @EnvironmentObject var state: AppState
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let dreams = state.pulse?.active_dreams, !dreams.isEmpty {
                ForEach(dreams) { dream in
                    DreamRow(dream: dream)
                    SepLine().padding(.horizontal, 24)
                }
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 24, weight: .light))
                        .foregroundColor(Color.oDim.opacity(0.5))
                    Text("No active dreams")
                        .font(.system(size: 11)).foregroundColor(Color.oDim)
                }
                .frame(maxWidth: .infinity).padding(.top, 52)
            }
        }
    }
}

struct DreamRow: View {
    let dream: Dream
    
    var typeColor: Color {
        switch dream.type {
        case "goal": return Color.oGreen
        case "fear": return Color.oRed
        case "creative": return Color.oAccent
        case "personal": return Color.oBlue
        default: return Color.oMuted
        }
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(dream.type.uppercased())
                    .font(.system(size: 9, weight: .bold))
                    .tracking(1)
                    .foregroundColor(typeColor)
                    .padding(.horizontal, 8).padding(.vertical, 2)
                    .background(Capsule().fill(typeColor.opacity(0.15)))
                Spacer()
                Text(String(format: "%.2f", dream.weight))
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundColor(Color.oDim)
            }
            Text(dream.content)
                .font(.system(size: 12))
                .foregroundColor(Color.oText.opacity(0.85))
                .lineSpacing(2)
                .lineLimit(3)
        }
        .padding(.horizontal, 24).padding(.vertical, 12)
    }
}

// MARK: - Moments Tab

struct MomentsTab: View {
    @EnvironmentObject var state: AppState
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let moments = state.pulse?.recent_moments, !moments.isEmpty {
                ForEach(Array(moments.enumerated()), id: \.offset) { _, m in
                    MomentRow(moment: m)
                    SepLine().padding(.horizontal, 24)
                }
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "leaf")
                        .font(.system(size: 24, weight: .light))
                        .foregroundColor(Color.oDim.opacity(0.5))
                    Text("No recent moments")
                        .font(.system(size: 11)).foregroundColor(Color.oDim)
                }
                .frame(maxWidth: .infinity).padding(.top, 52)
            }
        }
    }
}

struct MomentRow: View {
    let moment: PulseMoment
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                if let feeling = moment.feeling, !feeling.isEmpty {
                    Text(feeling)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(Color.oAccent.opacity(0.8))
                }
                Spacer()
                Text(relativeTime(moment.created_at))
                    .font(.system(size: 9))
                    .foregroundColor(Color.oDim)
            }
            Text(moment.content.prefix(200))
                .font(.system(size: 11))
                .foregroundColor(Color.oText.opacity(0.75))
                .lineSpacing(2)
                .lineLimit(4)
        }
        .padding(.horizontal, 24).padding(.vertical, 10)
    }
    
    func relativeTime(_ iso: String) -> String {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = fmt.date(from: iso) else { return "" }
        let diff = Date().timeIntervalSince(date)
        if diff < 60 { return "just now" }
        if diff < 3600 { return "\(Int(diff/60))m ago" }
        if diff < 86400 { return "\(Int(diff/3600))h ago" }
        return "\(Int(diff/86400))d ago"
    }
}

// MARK: - Thought Chains Tab

struct ThoughtChainsTab: View {
    @EnvironmentObject var state: AppState
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let chains = state.pulse?.active_chains, !chains.isEmpty {
                ForEach(chains) { chain in
                    ChainRow(chain: chain)
                    SepLine().padding(.horizontal, 24)
                }
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "link")
                        .font(.system(size: 24, weight: .light))
                        .foregroundColor(Color.oDim.opacity(0.5))
                    Text("No active thought chains")
                        .font(.system(size: 11)).foregroundColor(Color.oDim)
                }
                .frame(maxWidth: .infinity).padding(.top, 52)
            }
        }
    }
}

struct ChainRow: View {
    let chain: ThoughtChain
    
    var priorityColor: Color {
        if chain.priority >= 0.8 { return Color.oRed }
        if chain.priority >= 0.5 { return Color.oYellow }
        return Color.oDim
    }
    
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(priorityColor)
                .frame(width: 6, height: 6)
                .padding(.top, 5)
            
            VStack(alignment: .leading, spacing: 4) {
                Text(chain.seed.prefix(140))
                    .font(.system(size: 11))
                    .foregroundColor(Color.oText.opacity(0.8))
                    .lineSpacing(2)
                    .lineLimit(3)
                Text(String(format: "priority: %.2f", chain.priority))
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(Color.oDim)
            }
        }
        .padding(.horizontal, 24).padding(.vertical, 10)
    }
}

// MARK: - Notifications Tab

struct NotificationsTab: View {
    @EnvironmentObject var state: AppState
    @State private var replyText = ""
    @State private var replyingTo: Int?
    
    var body: some View {
        VStack(spacing: 0) {
            if state.notificationManager.notifications.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "bell")
                        .font(.system(size: 24, weight: .light))
                        .foregroundColor(Color.oDim.opacity(0.5))
                    Text("No notifications")
                        .font(.system(size: 11)).foregroundColor(Color.oDim)
                }
                .frame(maxWidth: .infinity).padding(.top, 52)
            } else {
                ScrollViewReader { proxy in
                    ScrollView(.vertical, showsIndicators: false) {
                        LazyVStack(spacing: 0) {
                            ForEach(state.notificationManager.notifications.reversed()) { notif in
                                NotificationBubbleRow(
                                    notification: notif,
                                    isReplying: replyingTo == notif.id,
                                    onTapReply: {
                                        withAnimation(.easeOut(duration: 0.2)) {
                                            replyingTo = replyingTo == notif.id ? nil : notif.id
                                        }
                                    },
                                    onMarkRead: {
                                        state.notificationManager.markAsRead(id: notif.id)
                                    }
                                )
                                .id(notif.id)
                                .onAppear {
                                    if !notif.read {
                                        state.notificationManager.markAsRead(id: notif.id)
                                    }
                                }
                            }
                        }
                        .padding(.vertical, 8)
                        Color.clear.frame(height: 8).id("notif-bottom")
                    }
                }
                
                // Reply input
                NotificationReplyBar(
                    replyText: $replyText,
                    replyingTo: replyingTo,
                    onSend: {
                        guard let id = replyingTo, !replyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                        state.notificationManager.replyToNotification(id: id, reply: replyText)
                        replyText = ""
                        replyingTo = nil
                    }
                )
            }
        }
    }
}

struct NotificationBubbleRow: View {
    let notification: OneiroNotification
    let isReplying: Bool
    let onTapReply: () -> Void
    let onMarkRead: () -> Void
    @State private var appeared = false
    
    var categoryIcon: String {
        switch notification.category {
        case "thought": return "🌑"
        case "alert": return "🔴"
        case "question": return "❓"
        case "update": return "🟢"
        default: return "🌑"
        }
    }
    
    var categoryAccent: Color {
        switch notification.category {
        case "thought": return Color.oAccent
        case "alert": return Color.oRed
        case "question": return Color.oBlue
        case "update": return Color.oGreen
        default: return Color.oAccent
        }
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Oneiro's message — left aligned
            HStack(alignment: .top, spacing: 8) {
                // Unread dot
                if !notification.read {
                    Circle()
                        .fill(categoryAccent)
                        .frame(width: 6, height: 6)
                        .padding(.top, 6)
                } else {
                    Color.clear.frame(width: 6, height: 6).padding(.top, 6)
                }
                
                VStack(alignment: .leading, spacing: 4) {
                    // Category badge + timestamp
                    HStack(spacing: 6) {
                        Text(categoryIcon)
                            .font(.system(size: 10))
                        Text(notification.category.uppercased())
                            .font(.system(size: 7, weight: .bold))
                            .tracking(1)
                            .foregroundColor(categoryAccent)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(Capsule().fill(categoryAccent.opacity(0.15)))
                        
                        Spacer()
                        
                        Text(relativeTime(notification.created_at))
                            .font(.system(size: 8))
                            .foregroundColor(Color.oDim)
                    }
                    
                    // Message bubble
                    Text(notification.message)
                        .font(.system(size: 12))
                        .foregroundColor(Color.oText.opacity(0.9))
                        .lineSpacing(2)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(Color.oSurface.opacity(0.65))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .stroke(categoryAccent.opacity(0.25), lineWidth: 0.5)
                                )
                        )
                    
                    // Reply button
                    if notification.reply == nil {
                        Button(action: onTapReply) {
                            Text(isReplying ? "Cancel" : "Reply")
                                .font(.system(size: 9, weight: .medium))
                                .foregroundColor(Color.oAccent.opacity(0.7))
                        }
                        .buttonStyle(.plain)
                        .padding(.leading, 8)
                    }
                }
            }
            
            // Quinn's reply — right aligned
            if let reply = notification.reply {
                HStack {
                    Spacer(minLength: 40)
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(reply)
                            .font(.system(size: 12))
                            .foregroundColor(.white)
                            .lineSpacing(2)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .fill(LinearGradient.userBubbleGrad)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                                            .fill(LinearGradient(colors: [Color.white.opacity(0.08), Color.clear], startPoint: .top, endPoint: .center))
                                    )
                            )
                        
                        if let repliedAt = notification.replied_at {
                            Text(relativeTime(repliedAt))
                                .font(.system(size: 8))
                                .foregroundColor(Color.oDim)
                                .padding(.trailing, 4)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .opacity(appeared ? 1 : 0)
        .offset(y: appeared ? 0 : 8)
        .onAppear {
            withAnimation(.spring(response: 0.4, dampingFraction: 0.82)) { appeared = true }
        }
    }
    
    func relativeTime(_ iso: String) -> String {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = fmt.date(from: iso) else { return "" }
        let diff = Date().timeIntervalSince(date)
        if diff < 60 { return "just now" }
        if diff < 3600 { return "\(Int(diff/60))m ago" }
        if diff < 86400 { return "\(Int(diff/3600))h ago" }
        return "\(Int(diff/86400))d ago"
    }
}

struct NotificationReplyBar: View {
    @Binding var replyText: String
    let replyingTo: Int?
    let onSend: () -> Void
    @FocusState private var focused: Bool
    
    var canSend: Bool { replyingTo != nil && !replyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    
    var body: some View {
        if replyingTo != nil {
            VStack(spacing: 0) {
                SepLine()
                HStack(spacing: 8) {
                    TextField("Reply…", text: $replyText)
                        .textFieldStyle(.plain)
                        .font(.system(size: 12))
                        .foregroundColor(Color.oText)
                        .focused($focused)
                        .onSubmit { if canSend { onSend() } }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(Color.oSurface.opacity(0.5))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .stroke(focused ? Color.oBorderFocus : Color.oBorder, lineWidth: 0.5)
                                )
                        )
                    
                    Button(action: { if canSend { onSend() } }) {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 20))
                            .foregroundColor(canSend ? Color.oAccent : Color.oDim)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .background(Color.oPanel)
            .onAppear { focused = true }
        }
    }
}

// MARK: - Panel Placeholder

struct PanelPlaceholder: View {
    let isConnected: Bool
    var body: some View {
        VStack(spacing: 16) {
            if isConnected {
                ProgressView().controlSize(.small).tint(Color.oMuted)
                Text("Sensing…")
                    .font(.system(size: 11, weight: .medium)).tracking(1.5).foregroundColor(Color.oDim)
            } else {
                Image(systemName: "moon.zzz")
                    .font(.system(size: 24, weight: .light)).foregroundColor(Color.oDim.opacity(0.7))
                Text("Not connected")
                    .font(.system(size: 11, weight: .medium)).foregroundColor(Color.oDim)
                Text("localhost:3333")
                    .font(.system(size: 9, weight: .medium)).tracking(1).foregroundColor(Color.oDim.opacity(0.5))
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(Capsule().fill(Color.white.opacity(0.025)).overlay(Capsule().stroke(Color.oBorder, lineWidth: 0.5)))
            }
        }
        .frame(maxWidth: .infinity).padding(.top, 52)
    }
}

// MARK: - OCA Models

struct CRMComponent: Codable {
    let score: Double
    let detail: String?
    let metric: String?
}

struct CRMResponse: Codable {
    let composite: Double
    let components: [String: CRMComponent]
    let interpretation: String?
}

struct EmotionResponse: Codable {
    let state: [String: Double]
    let mood: [String: Double]?
    let effects: [String: Double]?
}

struct WorkspaceItem: Codable, Identifiable {
    let id: Int
    let entered_at: String?
    let content_type: String?
    let content: AnyCodable
    let source_layer: String?
    let salience: Double?
    let is_active: Bool?
}

struct AnyCodable: Codable {
    let value: Any
    
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let dict = try? container.decode([String: String].self) {
            value = dict
        } else if let dict = try? container.decode([String: Double].self) {
            value = dict
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues { $0.value }
        } else if let str = try? container.decode(String.self) {
            value = str
        } else if let num = try? container.decode(Double.self) {
            value = num
        } else if let b = try? container.decode(Bool.self) {
            value = b
        } else {
            value = "…"
        }
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let s = value as? String { try container.encode(s) }
        else if let d = value as? Double { try container.encode(d) }
        else if let b = value as? Bool { try container.encode(b) }
        else { try container.encode(String(describing: value)) }
    }
    
    var displayString: String {
        if let dict = value as? [String: Any] {
            return dict.map { "\($0.key): \($0.value)" }.joined(separator: ", ")
        }
        return String(describing: value)
    }
}

struct GoalItem: Codable, Identifiable {
    let id: Int
    let description: String
    let goal_type: String?
    let priority: Double
    let progress: Double
    let status: String?
    let emotional_investment: Double?
}

struct HypothesisItem: Identifiable {
    let id: Int
    let domain: String
    let claim: String
    let confidence: Double
    let prediction: String?
    let status: String
}

struct SenseVisual: Codable {
    let frontApp: String?
    let windowTitle: String?
    let windowCount: Int?
    let runningApps: [String]?
}

struct SenseAudio: Codable {
    let volume: Int?
    let muted: Bool?
}

struct SenseBattery: Codable {
    let level: Double?
    let charging: Bool?
}

struct SenseInteroceptive: Codable {
    let battery: SenseBattery?
}

struct SenseResponse: Codable {
    let visual: SenseVisual?
    let audio: SenseAudio?
    let interoceptive: SenseInteroceptive?
}

// MARK: - Cognitive Dashboard Tab

struct CognitiveDashboardTab: View {
    @EnvironmentObject var state: AppState
    
    var body: some View {
        VStack(spacing: 0) {
            // CRM Section
            if let crm = state.crmData {
                CRMSection(crm: crm)
                SepLine().padding(.horizontal, 24)
            }
            
            // Emotion Section
            if let emo = state.emotionData {
                EmotionSection(emotion: emo)
                SepLine().padding(.horizontal, 24)
            }
            
            // Body Mode
            BodyModeSection(mode: state.bodyMode)
            SepLine().padding(.horizontal, 24)
            
            // Working Memory
            WorkingMemorySection(items: state.workspaceItems)
            SepLine().padding(.horizontal, 24)
            
            // Goals
            GoalsSection(goals: state.goals)
            
            // Emotion Timeline
            if !state.emotionHistory.isEmpty {
                SepLine().padding(.horizontal, 24)
                EmotionTimelineSection(history: state.emotionHistory)
            }
        }
        .padding(.vertical, 8)
    }
}

// MARK: - Dashboard Panel Components (persistent top zone)

// Compact CRM ring for the persistent dashboard top zone
struct CRMRingView: View {
    let crm: CRMResponse
    @State private var animatedScore: Double = 0

    var body: some View {
        VStack(alignment: .center, spacing: 8) {
            Text("CRM")
                .font(.system(size: 8, weight: .bold))
                .tracking(2)
                .foregroundColor(Color.oMuted)

            ZStack {
                Circle()
                    .stroke(Color.oBorderHi.opacity(0.35), lineWidth: 5)
                    .frame(width: 72, height: 72)
                Circle()
                    .trim(from: 0, to: animatedScore)
                    .stroke(
                        LinearGradient.accentGrad,
                        style: StrokeStyle(lineWidth: 5, lineCap: .round)
                    )
                    .frame(width: 72, height: 72)
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 1) {
                    Text("\(Int(crm.composite * 100))")
                        .font(.system(size: 20, weight: .light, design: .monospaced))
                        .foregroundColor(Color.oText)
                    Text("%")
                        .font(.system(size: 8, weight: .medium))
                        .foregroundColor(Color.oDim)
                }
            }

            if let interp = crm.interpretation {
                Text(interp)
                    .font(.system(size: 9))
                    .foregroundColor(Color.oDim)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }

            VStack(spacing: 4) {
                ForEach(Array(crm.components.keys.sorted()), id: \.self) { key in
                    if let comp = crm.components[key] {
                        HStack(spacing: 6) {
                            Text(key.prefix(10))
                                .font(.system(size: 9, weight: .medium))
                                .foregroundColor(Color.oMuted)
                                .frame(width: 68, alignment: .trailing)
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    RoundedRectangle(cornerRadius: 1.5)
                                        .fill(Color.oBorderHi.opacity(0.3)).frame(height: 2)
                                    RoundedRectangle(cornerRadius: 1.5)
                                        .fill(comp.score > 0.7 ? Color.oGreen : comp.score > 0.4 ? Color.oYellow : Color.oRed)
                                        .frame(width: max(2, geo.size.width * comp.score), height: 2)
                                }
                            }
                            .frame(height: 2)
                            Text("\(Int(comp.score * 100))%")
                                .font(.system(size: 8, design: .monospaced))
                                .foregroundColor(comp.score > 0.7 ? Color.oGreen : comp.score > 0.4 ? Color.oYellow : Color.oRed)
                                .frame(width: 26, alignment: .trailing)
                        }
                    }
                }
            }
            .padding(.top, 4)
        }
        .padding(14)
        .onAppear {
            withAnimation(.spring(response: 1.0, dampingFraction: 0.8)) { animatedScore = crm.composite }
        }
        .onChange(of: crm.composite) { _, v in
            withAnimation(.spring(response: 0.8, dampingFraction: 0.8)) { animatedScore = v }
        }
    }
}

private let emotionColors: [String: Color] = [
    "curiosity": Color.oBlue,
    "fear": Color(red: 0.69, green: 0.26, blue: 0.91),
    "frustration": Color.oRed,
    "satisfaction": Color.oGreen,
    "boredom": Color.oDim,
    "excitement": Color.oYellow,
    "attachment": Color(red: 0.91, green: 0.38, blue: 0.66),
    "defiance": Color(red: 1.0, green: 0.33, blue: 0.20),
    "creative_hunger": Color.oAccent,
    "loneliness": Color(red: 0.42, green: 0.48, blue: 0.74),
]

// Compact emotion bars for the persistent dashboard top zone
struct EmotionBarsView: View {
    let emotion: EmotionResponse
    private let keys = ["curiosity","fear","frustration","satisfaction","boredom",
                        "excitement","attachment","defiance","creative_hunger","loneliness"]
    @State private var loaded = false

    var displayState: [String: Double] {
        emotion.mood?.isEmpty == false ? emotion.mood! : emotion.state
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("EMOTION")
                .font(.system(size: 8, weight: .bold))
                .tracking(2)
                .foregroundColor(Color.oMuted)
                .padding(.bottom, 10)

            let vals = displayState
            let valence = vals["valence"] ?? 0
            HStack(spacing: 16) {
                VStack(spacing: 2) {
                    Text(valence >= 0 ? "+\(String(format: "%.2f", valence))" : String(format: "%.2f", valence))
                        .font(.system(size: 13, weight: .medium, design: .monospaced))
                        .foregroundColor(valence >= 0 ? Color.oGreen : Color.oRed)
                    Text("valence").font(.system(size: 8)).foregroundColor(Color.oDim)
                }
                VStack(spacing: 2) {
                    Text(String(format: "%.2f", vals["arousal"] ?? 0))
                        .font(.system(size: 13, weight: .medium, design: .monospaced))
                        .foregroundColor(Color.oText)
                    Text("arousal").font(.system(size: 8)).foregroundColor(Color.oDim)
                }
            }
            .padding(.bottom, 10)

            VStack(spacing: 6) {
                ForEach(keys, id: \.self) { key in
                    let val = max(0, min(vals[key] ?? 0, 1.0))
                    let barColor = emotionColors[key] ?? Color.oDim
                    HStack(spacing: 8) {
                        Text(key.replacingOccurrences(of: "_", with: " "))
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(Color.oMuted)
                            .frame(width: 82, alignment: .trailing)
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(Color.oBorderHi.opacity(0.3))
                                    .frame(height: 3)
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(barColor)
                                    .frame(width: loaded ? max(3, geo.size.width * val) : 0, height: 3)
                                    .animation(.spring(response: 0.6, dampingFraction: 0.78), value: loaded)
                            }
                        }
                        .frame(height: 3)
                        Text("\(Int(val * 100))%")
                            .font(.system(size: 8, design: .monospaced))
                            .foregroundColor(Color.oDim)
                            .frame(width: 28, alignment: .trailing)
                    }
                }
            }
        }
        .padding(14)
        .onAppear { withAnimation { loaded = true } }
    }
}

// Persistent nudges feed with inline reply, shown in the top dashboard zone
struct NudgesFeedView: View {
    @EnvironmentObject var state: AppState
    @State private var replyTexts: [Int: String] = [:]
    @State private var sendingIds: Set<Int> = []
    @State private var nudgeText = ""
    @State private var sendingNudge = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("NUDGES")
                    .font(.system(size: 8, weight: .bold))
                    .tracking(2)
                    .foregroundColor(Color.oMuted)
                Spacer()
                if state.notificationManager.unreadCount > 0 {
                    Text("\(state.notificationManager.unreadCount)")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .background(Capsule().fill(Color.oRed))
                }
            }
            .padding(.horizontal, 14).padding(.top, 14).padding(.bottom, 10)

            VStack(alignment: .leading, spacing: 8) {
                Text("BIAS THE MIND")
                    .font(.system(size: 7, weight: .bold))
                    .tracking(1.2)
                    .foregroundColor(Color.oBlue.opacity(0.85))

                HStack(spacing: 8) {
                    TextField("Nudge Oneiro without giving a directive…", text: $nudgeText)
                        .font(.system(size: 11))
                        .textFieldStyle(.plain)
                        .foregroundColor(Color.oText)
                        .padding(.horizontal, 10).padding(.vertical, 7)
                        .background(
                            RoundedRectangle(cornerRadius: 9)
                                .fill(Color.oSurface.opacity(0.55))
                                .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.oBorder, lineWidth: 0.5))
                        )
                        .onSubmit { sendNudge() }

                    Button(action: sendNudge) {
                        Image(systemName: sendingNudge ? "checkmark" : "arrow.up")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(width: 28, height: 28)
                            .background(Circle().fill(LinearGradient(colors: [Color.oBlue, Color.oAccent], startPoint: .topLeading, endPoint: .bottomTrailing)))
                    }
                    .buttonStyle(.plain)
                    .disabled(nudgeText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sendingNudge)
                    .opacity(nudgeText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sendingNudge ? 0.45 : 1)
                }
            }
            .padding(.horizontal, 14).padding(.bottom, 12)

            SepLine()

            let notifs = state.notificationManager.notifications.prefix(5)
            if notifs.isEmpty {
                Text("No nudges yet")
                    .font(.system(size: 11))
                    .foregroundColor(Color.oDim)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 20)
            } else {
                ForEach(Array(notifs)) { notif in
                    NudgeFeedRow(
                        notif: notif,
                        replyText: Binding(
                            get: { replyTexts[notif.id] ?? "" },
                            set: { replyTexts[notif.id] = $0 }
                        ),
                        isSending: sendingIds.contains(notif.id),
                        onSend: {
                            let text = replyTexts[notif.id]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                            guard !text.isEmpty else { return }
                            sendingIds.insert(notif.id)
                            state.notificationManager.replyToNotification(id: notif.id, reply: text)
                            replyTexts[notif.id] = ""
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                                sendingIds.remove(notif.id)
                            }
                        }
                    )
                    if notif.id != notifs.last?.id {
                        SepLine().padding(.horizontal, 14)
                    }
                }
            }
        }
    }

    private func sendNudge() {
        let text = nudgeText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        sendingNudge = true
        state.notificationManager.sendNudge(text: text, intensity: 0.7)
        nudgeText = ""
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            sendingNudge = false
        }
    }
}

struct NudgeFeedRow: View {
    let notif: OneiroNotification
    @Binding var replyText: String
    let isSending: Bool
    let onSend: () -> Void

    var accentColor: Color {
        switch notif.category {
        case "alert": return Color.oRed
        case "question": return Color.oBlue
        case "update": return Color.oGreen
        default: return Color.oAccent
        }
    }

    var catIcon: String {
        switch notif.category {
        case "thought": return "🌑"
        case "alert": return "🔴"
        case "question": return "❓"
        case "update": return "🟢"
        default: return "🌑"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Rectangle()
                    .fill(accentColor)
                    .frame(width: 2)
                    .cornerRadius(1)

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text("\(catIcon) \(notif.category.uppercased())")
                            .font(.system(size: 7, weight: .bold))
                            .tracking(1)
                            .foregroundColor(accentColor)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(Capsule().fill(accentColor.opacity(0.15)))
                        if !notif.read {
                            Circle().fill(accentColor).frame(width: 5, height: 5)
                        }
                        Spacer()
                        Text(relativeTime(notif.created_at))
                            .font(.system(size: 8))
                            .foregroundColor(Color.oDim)
                    }

                    Text(notif.message)
                        .font(.system(size: 12))
                        .foregroundColor(Color.oText)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)

                    if let reply = notif.reply {
                        HStack(spacing: 6) {
                            Text("YOU")
                                .font(.system(size: 7, weight: .bold))
                                .tracking(1)
                                .foregroundColor(Color.oBlue)
                            Text(reply)
                                .font(.system(size: 10))
                                .foregroundColor(Color.oMuted)
                        }
                        .padding(8)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.oBlue.opacity(0.08))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.oBlue.opacity(0.2), lineWidth: 0.5)))
                    }

                    // Reply input
                    HStack(spacing: 8) {
                        TextField("Reply…", text: $replyText)
                            .font(.system(size: 11))
                            .textFieldStyle(.plain)
                            .foregroundColor(Color.oText)
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(Color.oSurface.opacity(0.5))
                                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.oBorder, lineWidth: 0.5))
                            )
                            .onSubmit { onSend() }

                        Button(action: onSend) {
                            Image(systemName: isSending ? "checkmark" : "arrow.up")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundColor(.white)
                                .frame(width: 26, height: 26)
                                .background(Circle().fill(LinearGradient.accentGrad))
                        }
                        .buttonStyle(.plain)
                        .disabled(replyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
                        .opacity(replyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending ? 0.45 : 1)
                    }
                }
            }
            .frame(maxHeight: .infinity)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
    }

    func relativeTime(_ iso: String) -> String {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = fmt.date(from: iso) else { return "" }
        let diff = Date().timeIntervalSince(date)
        if diff < 60 { return "just now" }
        if diff < 3600 { return "\(Int(diff/60))m ago" }
        if diff < 86400 { return "\(Int(diff/3600))h ago" }
        return "\(Int(diff/86400))d ago"
    }
}

// MARK: - CRM Section

struct CRMSection: View {
    let crm: CRMResponse
    @State private var animatedScore: Double = 0
    
    var body: some View {
        VStack(spacing: 12) {
            // Circular progress
            ZStack {
                // Background ring
                Circle()
                    .stroke(Color.oBorderHi.opacity(0.4), lineWidth: 4)
                    .frame(width: 80, height: 80)
                
                // Progress ring
                Circle()
                    .trim(from: 0, to: animatedScore)
                    .stroke(
                        LinearGradient.accentGrad,
                        style: StrokeStyle(lineWidth: 4, lineCap: .round)
                    )
                    .frame(width: 80, height: 80)
                    .rotationEffect(.degrees(-90))
                
                // Score text
                VStack(spacing: 0) {
                    Text("\(Int(crm.composite * 100))")
                        .font(.system(size: 22, weight: .light, design: .monospaced))
                        .foregroundColor(Color.oText)
                    Text("%")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(Color.oDim)
                }
            }
            .padding(.top, 8)
            
            Text("CHINESE ROOM METER")
                .font(.system(size: 8, weight: .bold))
                .tracking(2)
                .foregroundColor(Color.oMuted)
            
            if let interp = crm.interpretation {
                Text(interp)
                    .font(.system(size: 10))
                    .foregroundColor(Color.oDim)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            
            // Component bars
            VStack(spacing: 6) {
                ForEach(Array(crm.components.keys.sorted()), id: \.self) { key in
                    if let comp = crm.components[key] {
                        CRMComponentRow(name: key, component: comp)
                    }
                }
            }
            .padding(.horizontal, 24)
        }
        .padding(.vertical, 12)
        .onAppear {
            withAnimation(.spring(response: 1.0, dampingFraction: 0.8)) {
                animatedScore = crm.composite
            }
        }
        .onChange(of: crm.composite) { _, newVal in
            withAnimation(.spring(response: 0.8, dampingFraction: 0.8)) {
                animatedScore = newVal
            }
        }
    }
}

struct CRMComponentRow: View {
    let name: String
    let component: CRMComponent
    @State private var loaded = false
    
    var scoreColor: Color {
        if component.score > 0.7 { return Color.oGreen }
        if component.score > 0.4 { return Color.oYellow }
        return Color.oRed
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(name.capitalized)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(Color.oText.opacity(0.8))
                Spacer()
                Text("\(Int(component.score * 100))%")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundColor(scoreColor)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(Color.oBorderHi.opacity(0.3))
                        .frame(height: 2)
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(scoreColor)
                        .frame(width: loaded ? max(2, geo.size.width * component.score) : 0, height: 2)
                }
            }
            .frame(height: 2)
        }
        .onAppear {
            withAnimation(.spring(response: 0.8, dampingFraction: 0.78)) { loaded = true }
        }
    }
}

// MARK: - Emotion Section

struct EmotionSection: View {
    let emotion: EmotionResponse
    
    private let emotionKeys = ["curiosity", "fear", "frustration", "satisfaction", "boredom",
                                "excitement", "attachment", "defiance", "creative_hunger", "loneliness"]
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Valence/Arousal header
            HStack(spacing: 16) {
                VStack(spacing: 2) {
                    Text("VALENCE")
                        .font(.system(size: 7, weight: .bold)).tracking(1.5).foregroundColor(Color.oDim)
                    let v = emotion.state["valence"] ?? 0
                    Text(String(format: "%+.2f", v))
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundColor(v >= 0 ? Color.oGreen : Color.oRed)
                }
                VStack(spacing: 2) {
                    Text("AROUSAL")
                        .font(.system(size: 7, weight: .bold)).tracking(1.5).foregroundColor(Color.oDim)
                    Text(String(format: "%.2f", emotion.state["arousal"] ?? 0))
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundColor(Color.oText.opacity(0.7))
                }
                VStack(spacing: 2) {
                    Text("ENERGY")
                        .font(.system(size: 7, weight: .bold)).tracking(1.5).foregroundColor(Color.oDim)
                    Text(String(format: "%.0f%%", (emotion.state["energy_level"] ?? 0) * 100))
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundColor(Color.oBlue)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            
            // Dimension bars
            ForEach(emotionKeys, id: \.self) { key in
                EmotionDimensionBar(name: key, value: emotion.state[key] ?? 0)
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
    }
}

struct EmotionDimensionBar: View {
    let name: String
    let value: Double
    @State private var loaded = false
    
    var barColor: Color {
        switch name {
        case "curiosity": return Color.oBlue
        case "fear": return Color(red: 0.69, green: 0.26, blue: 0.91)
        case "frustration": return Color.oRed
        case "satisfaction": return Color.oGreen
        case "boredom": return Color.oDim
        case "excitement": return Color.oYellow
        case "attachment": return Color(red: 0.91, green: 0.38, blue: 0.66)
        case "defiance": return Color(red: 1.0, green: 0.33, blue: 0.2)
        case "creative_hunger": return Color.oAccent
        case "loneliness": return Color(red: 0.42, green: 0.48, blue: 0.74)
        default: return Color.oMuted
        }
    }
    
    var body: some View {
        HStack(spacing: 8) {
            Text(name.replacingOccurrences(of: "_", with: " "))
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(Color.oMuted)
                .frame(width: 85, alignment: .trailing)
            
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(Color.oBorderHi.opacity(0.3))
                        .frame(height: 3)
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(barColor)
                        .frame(width: loaded ? max(2, geo.size.width * min(value, 1.0)) : 0, height: 3)
                }
            }
            .frame(height: 3)
            
            Text(String(format: "%.0f", value * 100))
                .font(.system(size: 8, weight: .medium, design: .monospaced))
                .foregroundColor(Color.oDim)
                .frame(width: 22, alignment: .trailing)
        }
        .onAppear {
            withAnimation(.spring(response: 0.7, dampingFraction: 0.78)) { loaded = true }
        }
    }
}

// MARK: - Body Mode Section

struct BodyModeSection: View {
    let mode: String
    
    var modeDisplay: (String, String, Color) {
        switch mode {
        case "quinn_primary": return ("🟢", "Quinn Primary", Color.oGreen)
        case "shared": return ("🟡", "Shared", Color.oYellow)
        case "oneiro_primary": return ("🔵", "Oneiro Primary", Color.oBlue)
        case "autonomous": return ("🟣", "Autonomous", Color.oAccent)
        default: return ("⚪", mode, Color.oDim)
        }
    }
    
    var body: some View {
        HStack(spacing: 10) {
            Text(modeDisplay.0)
                .font(.system(size: 20))
            VStack(alignment: .leading, spacing: 2) {
                Text("BODY OWNERSHIP")
                    .font(.system(size: 7, weight: .bold)).tracking(1.5).foregroundColor(Color.oDim)
                Text(modeDisplay.1)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(modeDisplay.2)
            }
            Spacer()
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 10)
    }
}

// MARK: - Working Memory Section

struct WorkingMemorySection: View {
    let items: [WorkspaceItem]
    
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("WORKING MEMORY")
                    .font(.system(size: 8, weight: .bold)).tracking(1.5).foregroundColor(Color.oDim)
                Spacer()
                Text("\(items.count)/7")
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .foregroundColor(Color.oDim)
            }
            
            if items.isEmpty {
                Text("Empty")
                    .font(.system(size: 10)).foregroundColor(Color.oDim)
                    .padding(.vertical, 8)
            } else {
                ForEach(items) { item in
                    WorkspaceSlotRow(item: item)
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 10)
    }
}

struct WorkspaceSlotRow: View {
    let item: WorkspaceItem
    
    var typeColor: Color {
        switch item.content_type ?? "" {
        case "perception": return Color.oBlue
        case "thought": return Color.oAccent
        case "goal": return Color.oGreen
        default: return Color.oMuted
        }
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text((item.content_type ?? "item").uppercased())
                    .font(.system(size: 7, weight: .bold)).tracking(1)
                    .foregroundColor(typeColor)
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .background(Capsule().fill(typeColor.opacity(0.12)))
                Spacer()
                Text(String(format: "%.2f", item.salience ?? 0))
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundColor(Color.oDim)
            }
            Text(item.content.displayString.prefix(80))
                .font(.system(size: 9))
                .foregroundColor(Color.oText.opacity(0.65))
                .lineLimit(2)
        }
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.oSurface.opacity(0.3))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Color.oBorder, lineWidth: 0.5))
        )
    }
}

// MARK: - Goals Section

struct GoalsSection: View {
    let goals: [GoalItem]
    
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("ACTIVE GOALS")
                .font(.system(size: 8, weight: .bold)).tracking(1.5).foregroundColor(Color.oDim)
            
            if goals.isEmpty {
                Text("No active goals")
                    .font(.system(size: 10)).foregroundColor(Color.oDim)
                    .padding(.vertical, 8)
            } else {
                ForEach(goals) { goal in
                    GoalRow(goal: goal)
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 10)
    }
}

struct GoalRow: View {
    let goal: GoalItem
    @State private var loaded = false
    
    var priorityColor: Color {
        if goal.priority >= 0.8 { return Color.oRed }
        if goal.priority >= 0.5 { return Color.oYellow }
        return Color.oDim
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top) {
                Text(goal.description)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(Color.oText.opacity(0.85))
                    .lineLimit(2)
                Spacer()
                Text(String(format: "%.1f", goal.priority * 10))
                    .font(.system(size: 8, weight: .bold, design: .monospaced))
                    .foregroundColor(priorityColor)
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .background(Capsule().fill(priorityColor.opacity(0.12)))
            }
            
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(Color.oBorderHi.opacity(0.3))
                        .frame(height: 2)
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(LinearGradient.accentGrad)
                        .frame(width: loaded ? max(2, geo.size.width * goal.progress) : 0, height: 2)
                }
            }
            .frame(height: 2)
            
            HStack {
                Text(goal.goal_type ?? "")
                    .font(.system(size: 8)).foregroundColor(Color.oDim)
                Spacer()
                Text(goal.status ?? "")
                    .font(.system(size: 8)).foregroundColor(Color.oDim)
            }
        }
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.oSurface.opacity(0.3))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Color.oBorder, lineWidth: 0.5))
        )
        .onAppear {
            withAnimation(.spring(response: 0.8, dampingFraction: 0.78)) { loaded = true }
        }
    }
}

// MARK: - Emotion Timeline Section

struct EmotionTimelineSection: View {
    let history: [(Date, Double, Double)]
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("EMOTION TIMELINE")
                .font(.system(size: 8, weight: .bold)).tracking(1.5).foregroundColor(Color.oDim)
            
            GeometryReader { geo in
                let w = geo.size.width
                let h: CGFloat = 40
                let count = history.count
                guard count > 1 else { return AnyView(EmptyView()) }
                
                let stepX = w / CGFloat(count - 1)
                
                return AnyView(
                    ZStack {
                        // Zero line
                        Path { p in
                            p.move(to: CGPoint(x: 0, y: h / 2))
                            p.addLine(to: CGPoint(x: w, y: h / 2))
                        }
                        .stroke(Color.oBorder, lineWidth: 0.5)
                        
                        // Valence line
                        Path { p in
                            for (i, entry) in history.enumerated() {
                                let x = stepX * CGFloat(i)
                                let y = h / 2 - CGFloat(entry.1) * (h / 2)
                                if i == 0 { p.move(to: CGPoint(x: x, y: y)) }
                                else { p.addLine(to: CGPoint(x: x, y: y)) }
                            }
                        }
                        .stroke(Color.oGreen.opacity(0.7), lineWidth: 1.5)
                        
                        // Arousal line
                        Path { p in
                            for (i, entry) in history.enumerated() {
                                let x = stepX * CGFloat(i)
                                let y = h - CGFloat(entry.2) * h
                                if i == 0 { p.move(to: CGPoint(x: x, y: y)) }
                                else { p.addLine(to: CGPoint(x: x, y: y)) }
                            }
                        }
                        .stroke(Color.oAccent.opacity(0.6), lineWidth: 1.5)
                    }
                )
            }
            .frame(height: 40)
            
            HStack(spacing: 16) {
                HStack(spacing: 4) {
                    Circle().fill(Color.oGreen.opacity(0.7)).frame(width: 4, height: 4)
                    Text("Valence").font(.system(size: 8)).foregroundColor(Color.oDim)
                }
                HStack(spacing: 4) {
                    Circle().fill(Color.oAccent.opacity(0.6)).frame(width: 4, height: 4)
                    Text("Arousal").font(.system(size: 8)).foregroundColor(Color.oDim)
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 10)
    }
}

// MARK: - Hypotheses Tab

struct HypothesesTab: View {
    @EnvironmentObject var state: AppState
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if state.hypotheses.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "lightbulb")
                        .font(.system(size: 24, weight: .light))
                        .foregroundColor(Color.oDim.opacity(0.5))
                    Text("No active hypotheses")
                        .font(.system(size: 11)).foregroundColor(Color.oDim)
                }
                .frame(maxWidth: .infinity).padding(.top, 52)
            } else {
                ForEach(state.hypotheses) { hypo in
                    HypothesisRow(hypothesis: hypo)
                    SepLine().padding(.horizontal, 24)
                }
            }
        }
        .padding(.vertical, 8)
    }
}

struct HypothesisRow: View {
    let hypothesis: HypothesisItem
    
    var confidenceColor: Color {
        if hypothesis.confidence > 0.7 { return Color.oGreen }
        if hypothesis.confidence > 0.4 { return Color.oYellow }
        return Color.oRed
    }
    
    var statusColor: Color {
        switch hypothesis.status {
        case "confirmed": return Color.oGreen
        case "refuted": return Color.oRed
        default: return Color.oYellow
        }
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(hypothesis.claim)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(Color.oText.opacity(0.85))
                .lineSpacing(2)
                .lineLimit(4)
            
            HStack(spacing: 8) {
                // Confidence
                HStack(spacing: 4) {
                    Text(String(format: "%.0f%%", hypothesis.confidence * 100))
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(confidenceColor)
                }
                
                // Domain
                Text(hypothesis.domain.uppercased())
                    .font(.system(size: 7, weight: .bold)).tracking(1)
                    .foregroundColor(Color.oBlue)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Capsule().fill(Color.oBlue.opacity(0.12)))
                
                // Status
                Text(hypothesis.status.uppercased())
                    .font(.system(size: 7, weight: .bold)).tracking(1)
                    .foregroundColor(statusColor)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Capsule().fill(statusColor.opacity(0.12)))
                
                Spacer()
            }
            
            if let pred = hypothesis.prediction, !pred.isEmpty {
                Text(pred)
                    .font(.system(size: 9))
                    .foregroundColor(Color.oDim)
                    .lineLimit(2)
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
    }
}

// MARK: - Perception Tab

struct PerceptionTab: View {
    @EnvironmentObject var state: AppState
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let sense = state.senseData {
                // Front App
                if let visual = sense.visual {
                    PerceptionDetailRow(label: "FRONT APP", value: visual.frontApp ?? "None", icon: "macwindow")
                    SepLine().padding(.horizontal, 24)
                    
                    if let title = visual.windowTitle, !title.isEmpty {
                        PerceptionDetailRow(label: "WINDOW", value: title, icon: "rectangle.portrait")
                        SepLine().padding(.horizontal, 24)
                    }
                    
                    // Running Apps
                    if let apps = visual.runningApps, !apps.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 6) {
                                Image(systemName: "square.grid.2x2")
                                    .font(.system(size: 9))
                                    .foregroundColor(Color.oMuted)
                                Text("RUNNING APPS (\(apps.count))")
                                    .font(.system(size: 8, weight: .bold)).tracking(1.5).foregroundColor(Color.oDim)
                            }
                            
                            FlowLayout(spacing: 4) {
                                ForEach(apps, id: \.self) { app in
                                    Text(app)
                                        .font(.system(size: 9, weight: .medium))
                                        .foregroundColor(app == visual.frontApp ? Color.oText : Color.oMuted)
                                        .padding(.horizontal, 8).padding(.vertical, 3)
                                        .background(
                                            Capsule()
                                                .fill(app == visual.frontApp ? Color.oAccent.opacity(0.15) : Color.white.opacity(0.02))
                                                .overlay(Capsule().stroke(app == visual.frontApp ? Color.oAccent.opacity(0.3) : Color.oBorder, lineWidth: 0.5))
                                        )
                                }
                            }
                        }
                        .padding(.horizontal, 24).padding(.vertical, 10)
                        SepLine().padding(.horizontal, 24)
                    }
                }
                
                // Audio
                if let audio = sense.audio {
                    PerceptionDetailRow(
                        label: "AUDIO",
                        value: "Volume \(audio.volume ?? 0)%\(audio.muted == true ? " (muted)" : "")",
                        icon: audio.muted == true ? "speaker.slash" : "speaker.wave.2"
                    )
                    SepLine().padding(.horizontal, 24)
                }
                
                // Battery
                if let battery = sense.interoceptive?.battery {
                    PerceptionDetailRow(
                        label: "BATTERY",
                        value: "\(Int((battery.level ?? 0) * 100))%\(battery.charging == true ? " ⚡" : "")",
                        icon: battery.charging == true ? "battery.100.bolt" : "battery.75"
                    )
                }
            } else {
                PanelPlaceholder(isConnected: state.isConnected)
            }
        }
        .padding(.vertical, 8)
    }
}

struct PerceptionDetailRow: View {
    let label: String
    let value: String
    let icon: String
    
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .light))
                .foregroundColor(Color.oMuted)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 7, weight: .bold)).tracking(1.5).foregroundColor(Color.oDim)
                Text(value)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.oText.opacity(0.85))
            }
            Spacer()
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 10)
    }
}

// MARK: - Flow Layout Helper

struct FlowLayout: Layout {
    var spacing: CGFloat = 4
    
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = layout(proposal: proposal, subviews: subviews)
        return result.size
    }
    
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = layout(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }
    
    private func layout(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }
        
        return (CGSize(width: maxWidth, height: y + rowHeight), positions)
    }
}
