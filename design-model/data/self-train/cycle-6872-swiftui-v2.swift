struct ContentView: View {
    @State private var apologyText: String = ""
    @State private var isComposing: Bool = true
    @State private var sentPlanes: [SentPlane] = []
    @State private var activeWindow: WindowLight?
    @State private var showingReceipt: Bool = false
    @State private var receivedMessage: String = ""
    
    var body: some View {
        ZStack {
            // Unified night gradient
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.05, blue: 0.12),
                    Color(red: 0.08, green: 0.08, blue: 0.18)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            
            // Simple cityscape silhouette
            VStack {
                Spacer()
                HStack(spacing: 0) {
                    ForEach(0..<3) { i in
                        Rectangle()
                            .fill(Color.black.opacity(0.3))
                            .frame(width: 200, height: CGFloat(250 + i * 50))
                    }
                }
            }
            
            if isComposing {
                ComposeView(apologyText: $apologyText, isComposing: $isComposing, activeWindow: $activeWindow)
                    .transition(.asymmetric(
                        insertion: .opacity.combined(with: .scale(scale: 0.9)),
                        removal: .move(edge: .leading).combined(with: .opacity)
                    ))
            } else if let window = activeWindow {
                DeliveryView(
                    window: window,
                    apologyText: apologyText,
                    onDelivered: {
                        sentPlanes.append(SentPlane(text: apologyText, window: window))
                        showingReceipt = true
                        receivedMessage = apologyText
                        withAnimation(.easeInOut(duration: 0.6)) {
                            activeWindow = nil
                        }
                    }
                )
                .transition(.asymmetric(
                    insertion: .move(edge: .trailing).combined(with: .opacity),
                    removal: .opacity
                ))
            }
            
            if showingReceipt {
                ReceiptView(
                    message: receivedMessage,
                    onDismiss: {
                        showingReceipt = false
                        isComposing = true
                        apologyText = ""
                    }
                )
            }
        }
        .animation(.easeInOut(duration: 0.5), value: isComposing)
        .animation(.easeInOut(duration: 0.5), value: activeWindow)
    }
}

struct ComposeView: View {
    @Binding var apologyText: String
    @Binding var isComposing: Bool
    @Binding var activeWindow: WindowLight?
    
    var body: some View {
        VStack(spacing: 40) {
            Text("Write Your Apology")
                .font(.system(size: 32, weight: .thin, design: .serif))
                .foregroundColor(.white.opacity(0.9))
                .padding(.top, 60)
            
            VStack(alignment: .leading, spacing: 16) {
                Text("To:")
                    .font(.system(size: 14, weight: .light))
                    .foregroundColor(.white.opacity(0.6))
                
                ZStack(alignment: .topLeading) {
                    if apologyText.isEmpty {
                        Text("I'm sorry for...")
                            .font(.system(size: 18, weight: .light))
                            .foregroundColor(.white.opacity(0.3))
                            .padding(.horizontal, 20)
                            .padding(.vertical, 16)
                    }
                    
                    TextEditor(text: $apologyText)
                        .font(.system(size: 18, weight: .light))
                        .foregroundColor(.white)
                        .scrollContentBackground(.hidden)
                        .background(Color.white.opacity(0.08))
                        .frame(width: 500, height: 150)
                        .cornerRadius(12)
                }
            }
            .padding(.horizontal, 40)
            
            Button(action: {
                if !apologyText.isEmpty {
                    withAnimation {
                        activeWindow = WindowLight(
                            id: UUID(),
                            position: CGPoint(x: 400, y: 300),
                            isTarget: true
                        )
                        isComposing = false
                    }
                }
            }) {
                HStack(spacing: 12) {
                    Image(systemName: "paperplane")
                        .font(.system(size: 16))
                    Text("Send")
                        .font(.system(size: 16, weight: .medium))
                }
                .foregroundColor(.white)
                .padding(.horizontal, 40)
                .padding(.vertical, 14)
                .background(
                    Capsule()
                        .fill(Color.white.opacity(apologyText.isEmpty ? 0.1 : 0.2))
                        .overlay(
                            Capsule()
                                .stroke(Color.white.opacity(0.3), lineWidth: 1)
                        )
                )
            }
            .disabled(apologyText.isEmpty)
            
            Spacer()
        }
    }
}

struct DeliveryView: View {
    let window: WindowLight
    let apologyText: String
    let onDelivered: () -> Void
    
    @State private var planePosition: CGPoint = CGPoint(x: 200, y: 400)
    @State private var planeRotation: Double = -15
    @State private var delivered: Bool = false
    
    var body: some View {
        ZStack {
            // Target window
            WindowView(window: window, isGlowing: !delivered)
            
            // Paper plane
            if !delivered {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 30))
                    .foregroundColor(.white)
                    .rotationEffect(.degrees(planeRotation))
                    .position(planePosition)
                    .onAppear {
                        withAnimation(.easeInOut(duration: 2.0)) {
                            planePosition = window.position
                            planeRotation = 0
                        }
                        
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                            delivered = true
                            onDelivered()
                        }
                    }
            }
            
            // Flight trail
            Path { path in
                path.move(to: CGPoint(x: 200, y: 400))
                path.addCurve(
                    to: window.position,
                    control1: CGPoint(x: 300, y: 250),
                    control2: CGPoint(x: window.position.x - 50, y: window.position.y + 50)
                )
            }
            .stroke(
                LinearGradient(
                    colors: [
                        Color.white.opacity(0.3),
                        Color.white.opacity(0.1),
                        Color.clear
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                ),
                style: StrokeStyle(lineWidth: 2, dash: [5, 3])
            )
            .opacity(delivered ? 0 : 0.6)
            .animation(.easeOut(duration: 0.5), value: delivered)
        }
    }
}

struct WindowView: View {
    let window: WindowLight
    let isGlowing: Bool
    
    var body: some View {
        ZStack {
            // Window glow
            if isGlowing {
                Circle()
                    .fill(Color.yellow.opacity(0.3))
                    .frame(width: 80, height: 80)
                    .blur(radius: 20)
            }
            
            // Window frame
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.black.opacity(0.4))
                .frame(width: 40, height: 50)
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(Color.yellow.opacity(0.8), lineWidth: 2)
                )
            
            // Window panes
            VStack(spacing: 2) {
                HStack(spacing: 2) {
                    Rectangle().fill(Color.yellow.opacity(0.6))
                    Rectangle().fill(Color.yellow.opacity(0.6))
                }
                HStack(spacing: 2) {
                    Rectangle().fill(Color.yellow.opacity(0.6))
                    Rectangle().fill(Color.yellow.opacity(0.6))
                }
            }
            .frame(width: 30, height: 40)
            .cornerRadius(2)
        }
        .position(window.position)
        .scaleEffect(isGlowing ? 1.1 : 1.0)
        .animation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true), value: isGlowing)
    }
}

struct ReceiptView: View {
    let message: String
    let onDismiss: () -> Void
    
    @State private var showContent: Bool = false
    
    var body: some View {
        ZStack {
            Color.black.opacity(0.6)
                .ignoresSafeArea()
                .onTapGesture { onDismiss() }
            
            VStack(spacing: 24) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 60))
                    .foregroundColor(.green.opacity(0.8))
                
                Text("Message Delivered")
                    .font(.system(size: 24, weight: .light))
                    .foregroundColor(.white)
                
                Text("Your apology reached its destination")
                    .font(.system(size: 16, weight: .light))
                    .foregroundColor(.white.opacity(0.6))
                
                Button(action: onDismiss) {
                    Text("Write Another")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white)
                        .padding(.horizontal, 32)
                        .padding(.vertical, 12)
                        .background(
                            Capsule()
                                .stroke(Color.white.opacity(0.3), lineWidth: 1)
                        )
                }
                .padding(.top, 20)
            }
            .padding(40)
            .background(
                RoundedRectangle(cornerRadius: 20)
                    .fill(Color.black.opacity(0.8))
            )
            .scaleEffect(showContent ? 1 : 0.8)
            .opacity(showContent ? 1 : 0)
            .onAppear {
                withAnimation(.spring()) {
                    showContent = true
                }
            }
        }
    }
}

struct WindowLight: Identifiable {
    let id: UUID
    let position: CGPoint
    let isTarget: Bool
}

struct SentPlane {
    let text: String
    let window: WindowLight
}