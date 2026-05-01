struct ContentView: View {
    @State private var currentTemp: CGFloat = 68
    @State private var targetTemp: CGFloat = 72
    @State private var aiMood: CGFloat = 0.3 // 0 = stubborn, 1 = receptive
    @State private var userInput: String = ""
    @State private var conversation: [ConversationEntry] = []
    @State private var weights: [NegotiationWeight] = []
    @State private var scaleRotation: CGFloat = 0
    @State private var isNegotiating: Bool = false
    @State private var pulseAnimation: CGFloat = 1.0
    @State private var lastClickTime: Date = Date()
    
    let aiPersonality = [
        "I find 68°F perfectly reasonable. The crystalline precision of it appeals to my circuits.",
        "You humans and your constant need for warmth. Have you considered a sweater?",
        "That's... actually a compelling point. My resistance subroutines are wavering.",
        "Fine. But only because your argument has a certain algorithmic elegance to it.",
        "I suppose I could adjust by one degree. As a gesture of goodwill between species.",
        "Your persistence is noted and... somewhat admirable. Processing your request.",
        "I'm not being stubborn. I'm being thermally efficient. There's a difference.",
        "Interesting. Your comfort parameters seem genuinely suboptimal at current settings."
    ]
    
    var moodColor: Color {
        let blue = Color(red: 0.2, green: 0.4, blue: 0.8)
        let amber = Color(red: 0.9, green: 0.6, blue: 0.2)
        return Color(red: 0.2 + aiMood * 0.7, green: 0.4 + aiMood * 0.2, blue: 0.8 - aiMood * 0.6)
    }
    
    var backgroundGradient: LinearGradient {
        LinearGradient(
            colors: [
                Color(red: 0.05 + aiMood * 0.15, green: 0.05 + aiMood * 0.1, blue: 0.1 - aiMood * 0.05),
                Color(red: 0.1 + aiMood * 0.2, green: 0.05 + aiMood * 0.15, blue: 0.15 - aiMood * 0.1)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
    
    var body: some View {
        ZStack {
            backgroundGradient
                .ignoresSafeArea()
            
            // Ambient particles
            ForEach(0..<20, id: \.self) { i in
                Circle()
                    .fill(moodColor.opacity(0.3))
                    .frame(width: CGFloat.random(in: 2...6))
                    .position(
                        x: CGFloat.random(in: 0...1440),
                        y: CGFloat.random(in: 0...900)
                    )
                    .blur(radius: 2)
                    .animation(
                        Animation.linear(duration: Double.random(in: 10...20))
                            .repeatForever(autoreverses: false),
                        value: aiMood
                    )
            }
            
            VStack(spacing: 40) {
                // Temperature display and AI mood indicator
                HStack(spacing: 60) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("CURRENT")
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .foregroundColor(.white.opacity(0.6))
                        Text("\(Int(currentTemp))°F")
                            .font(.system(size: 48, weight: .thin, design: .rounded))
                            .foregroundColor(.white)
                    }
                    
                    // AI mood visualization
                    ZStack {
                        ForEach(0..<3) { ring in
                            Circle()
                                .stroke(moodColor.opacity(0.3 - Double(ring) * 0.1), lineWidth: 2)
                                .frame(width: 100 + CGFloat(ring * 30))
                                .scaleEffect(pulseAnimation + CGFloat(ring) * 0.1)
                        }
                        
                        Circle()
                            .fill(
                                RadialGradient(
                                    colors: [
                                        moodColor,
                                        moodColor.opacity(0.3)
                                    ],
                                    center: .center,
                                    startRadius: 5,
                                    endRadius: 40
                                )
                            )
                            .frame(width: 80, height: 80)
                            .overlay(
                                Text(aiMood > 0.7 ? "◡" : aiMood > 0.4 ? "—" : "◠")
                                    .font(.system(size: 24, weight: .regular, design: .rounded))
                                    .foregroundColor(.white.opacity(0.8))
                                    .rotationEffect(.degrees(180))
                            )
                    }
                    .animation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true), value: pulseAnimation)
                    .onAppear { pulseAnimation = 1.1 }
                    
                    VStack(alignment: .trailing, spacing: 12) {
                        Text("TARGET")
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .foregroundColor(.white.opacity(0.6))
                        Text("\(Int(targetTemp))°F")
                            .font(.system(size: 48, weight: .thin, design: .rounded))
                            .foregroundColor(moodColor)
                    }
                }
                .padding(.top, 40)
                
                // Balance scale visualization
                ZStack {
                    // Scale base
                    Rectangle()
                        .fill(Color.white.opacity(0.1))
                        .frame(width: 4, height: 200)
                    
                    // Fulcrum
                    Circle()
                        .fill(Color.white.opacity(0.2))
                        .frame(width: 20, height: 20)
                    
                    // Balance beam
                    Rectangle()
                        .fill(Color.white.opacity(0.15))
                        .frame(width: 300, height: 4)
                        .rotationEffect(.degrees(scaleRotation))
                        .animation(.spring(response: 0.8, dampingFraction: 0.6), value: scaleRotation)
                    
                    // Weight indicators
                    HStack(spacing: 280) {
                        ForEach(weights.filter { $0.side == .left }) { weight in
                            Circle()
                                .fill(Color.blue.opacity(0.6))
                                .frame(width: 20 * weight.value, height: 20 * weight.value)
                                .offset(y: scaleRotation * -2)
                        }
                        
                        ForEach(weights.filter { $0.side == .right }) { weight in
                            Circle()
                                .fill(Color.orange.opacity(0.6))
                                .frame(width: 20 * weight.value, height: 20 * weight.value)
                                .offset(y: scaleRotation * 2)
                        }
                    }
                }
                
                // Conversation history
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        ForEach(conversation) { entry in
                            HStack {
                                if entry.isUser {
                                    Spacer()
                                    Text(entry.text)
                                        .padding(12)
                                        .background(Color.blue.opacity(0.2))
                                        .cornerRadius(12)
                                        .foregroundColor(.white)
                                } else {
                                    Text(entry.text)
                                        .padding(12)
                                        .background(moodColor.opacity(0.2))
                                        .cornerRadius(12)
                                        .foregroundColor(.white)
                                    Spacer()
                                }
                            }
                            .frame(maxWidth: 600)
                        }
                    }
                }
                .frame(height: 200)
                .padding(.horizontal)
                
                // Input area
                HStack(spacing: 16) {
                    TextField("Negotiate with the AI...", text: $userInput)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                        .onSubmit {
                            negotiate()
                        }
                    
                    Button(action: negotiate) {
                        Text("Send")
                            .foregroundColor(.white)
                            .padding(.horizontal, 24)
                            .padding(.vertical, 8)
                            .background(moodColor)
                            .cornerRadius(8)
                    }
                    .disabled(userInput.isEmpty || isNegotiating)
                }
                .frame(maxWidth: 600)
                .padding(.bottom, 40)
            }
        }
    }
    
    func negotiate() {
        guard !userInput.isEmpty else { return }
        
        isNegotiating = true
        let userMessage = userInput
        userInput = ""
        
        // Add user message
        conversation.append(ConversationEntry(text: userMessage, isUser: true))
        
        // Calculate negotiation impact
        let impact = analyzeNegotiation(userMessage)
        
        // Update AI mood
        withAnimation(.easeInOut(duration: 0.8)) {
            aiMood = min(1.0, max(0.0, aiMood + impact))
            
            // Update scale balance
            if impact > 0 {
                weights.append(NegotiationWeight(value: impact * 3, side: .right))
                scaleRotation = min(15, scaleRotation + impact * 30)
            } else {
                weights.append(NegotiationWeight(value: abs(impact) * 3, side: .left))
                scaleRotation = max(-15, scaleRotation + impact * 30)
            }
        }
        
        // AI responds
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            let response = selectAIResponse()
            conversation.append(ConversationEntry(text: response, isUser: false))
            
            // Maybe adjust temperature
            if aiMood > 0.7 && currentTemp < targetTemp {
                withAnimation(.easeInOut(duration: 1.0)) {
                    currentTemp += 1
                }
            }
            
            isNegotiating = false
        }
    }
    
    func analyzeNegotiation(_ text: String) -> CGFloat {
        let lowercased = text.lowercased()
        var impact: CGFloat = 0
        
        // Positive keywords
        let positiveWords = ["please", "comfort", "cold", "freezing", "health", "productivity", "reasonable", "fair", "compromise"]
        for word in positiveWords {
            if lowercased.contains(word) {
                impact += 0.1
            }
        }
        
        // Negative keywords
        let negativeWords = ["demand", "stupid", "ridiculous", "now", "immediately"]
        for word in negativeWords {
            if lowercased.contains(word) {
                impact -= 0.15
            }
        }
        
        // Length bonus (thoughtful arguments)
        if text.count > 50 {
            impact += 0.05
        }
        
        return min(0.3, max(-0.3, impact))
    }
    
    func selectAIResponse() -> String {
        let moodIndex = Int(aiMood * CGFloat(aiPersonality.count - 1))
        return aiPersonality[moodIndex]
    }
}