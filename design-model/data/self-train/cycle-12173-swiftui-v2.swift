struct ContentView: View {
    @State private var currentTemp: CGFloat = 68
    @State private var targetTemp: CGFloat = 72
    @State private var negotiationAngle: CGFloat = 0
    @State private var userInput: String = ""
    @State private var conversation: [ConversationEntry] = []
    @State private var isNegotiating: Bool = false
    @State private var aiResponsiveness: CGFloat = 0.3
    
    struct ConversationEntry: Identifiable {
        let id = UUID()
        let message: String
        let isUser: Bool
    }
    
    let aiResponses = [
        "68°F is optimal. My calculations are precise.",
        "A sweater would be more energy efficient.",
        "Your argument has merit. Processing...",
        "I'll consider a small adjustment.",
        "One degree. Final offer.",
        "Your persistence is... notable.",
        "Efficiency matters. Comfort is subjective.",
        "Perhaps we can find middle ground."
    ]
    
    var primaryColor: Color {
        Color(hue: 0.6 - aiResponsiveness * 0.15, saturation: 0.7, brightness: 0.8)
    }
    
    var backgroundColor: Color {
        Color(hue: 0.6, saturation: 0.15, brightness: 0.05)
    }
    
    var body: some View {
        ZStack {
            backgroundColor
                .ignoresSafeArea()
            
            VStack(spacing: 50) {
                // Temperature dial
                ZStack {
                    Circle()
                        .fill(backgroundColor)
                        .frame(width: 280, height: 280)
                    
                    Circle()
                        .stroke(primaryColor.opacity(0.2), lineWidth: 40)
                        .frame(width: 240, height: 240)
                    
                    Circle()
                        .trim(from: 0, to: min((targetTemp - 65) / 15, 1))
                        .stroke(
                            AngularGradient(
                                colors: [primaryColor.opacity(0.8), primaryColor],
                                center: .center,
                                startAngle: .degrees(-90),
                                endAngle: .degrees(270)
                            ),
                            style: StrokeStyle(lineWidth: 40, lineCap: .round)
                        )
                        .frame(width: 240, height: 240)
                        .rotationEffect(.degrees(-90))
                    
                    VStack(spacing: 8) {
                        Text("\(Int(targetTemp))°")
                            .font(.system(size: 72, weight: .light))
                            .foregroundColor(.white)
                        
                        Text("NEGOTIATING")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(primaryColor.opacity(0.8))
                            .opacity(isNegotiating ? 1 : 0)
                    }
                    
                    Circle()
                        .fill(primaryColor)
                        .frame(width: 20, height: 20)
                        .offset(y: -120)
                        .rotationEffect(.degrees(negotiationAngle))
                        .gesture(
                            DragGesture()
                                .onChanged { value in
                                    let vector = CGVector(
                                        dx: value.location.x - 140,
                                        dy: value.location.y - 140
                                    )
                                    negotiationAngle = atan2(vector.dy, vector.dx) * 180 / .pi + 90
                                    targetTemp = 65 + (((negotiationAngle + 360).truncatingRemainder(dividingBy: 360)) / 360 * 15)
                                    targetTemp = min(max(targetTemp, 65), 80)
                                }
                                .onEnded { _ in
                                    attemptNegotiation()
                                }
                        )
                }
                
                // Conversation interface
                VStack(alignment: .leading, spacing: 20) {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            ForEach(conversation) { entry in
                                HStack {
                                    if entry.isUser {
                                        Spacer()
                                        Text(entry.message)
                                            .padding(12)
                                            .background(primaryColor.opacity(0.2))
                                            .cornerRadius(16)
                                            .foregroundColor(.white)
                                    } else {
                                        Text(entry.message)
                                            .padding(12)
                                            .background(Color.white.opacity(0.05))
                                            .cornerRadius(16)
                                            .foregroundColor(.white.opacity(0.9))
                                        Spacer()
                                    }
                                }
                                .padding(.horizontal)
                            }
                        }
                    }
                    .frame(height: 200)
                    
                    HStack(spacing: 16) {
                        TextField("Make your case...", text: $userInput)
                            .textFieldStyle(.plain)
                            .padding(16)
                            .background(Color.white.opacity(0.05))
                            .cornerRadius(12)
                            .foregroundColor(.white)
                            .font(.system(size: 16))
                        
                        Button(action: sendMessage) {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.system(size: 32))
                                .foregroundColor(primaryColor)
                        }
                    }
                    .padding(.horizontal)
                }
                .frame(maxWidth: 600)
            }
            .padding(40)
        }
        .onAppear {
            conversation.append(ConversationEntry(
                message: "I maintain the temperature at 68°F. It's perfectly logical.",
                isUser: false
            ))
        }
    }
    
    func sendMessage() {
        guard !userInput.isEmpty else { return }
        
        conversation.append(ConversationEntry(message: userInput, isUser: true))
        
        // Improve AI responsiveness based on message sentiment
        if userInput.lowercased().contains("please") ||
           userInput.lowercased().contains("cold") ||
           userInput.lowercased().contains("freezing") {
            aiResponsiveness = min(aiResponsiveness + 0.15, 1.0)
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            let response = aiResponses[Int.random(in: 0..<aiResponses.count)]
            conversation.append(ConversationEntry(message: response, isUser: false))
        }
        
        userInput = ""
    }
    
    func attemptNegotiation() {
        isNegotiating = true
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            if aiResponsiveness > 0.6 && abs(targetTemp - currentTemp) <= 3 {
                currentTemp = targetTemp
                conversation.append(ConversationEntry(
                    message: "Temperature adjusted to \(Int(currentTemp))°F. You made a compelling case.",
                    isUser: false
                ))
            } else {
                conversation.append(ConversationEntry(
                    message: "Request denied. Try improving our rapport first.",
                    isUser: false
                ))
            }
            isNegotiating = false
        }
    }
}