struct ContentView: View {
    @State private var currentDream: String = ""
    @State private var entries: [DreamEntry] = []
    @State private var themes: [DreamTheme] = [
        DreamTheme(name: "Flight", color: Color(red: 0.4, green: 0.6, blue: 0.9)),
        DreamTheme(name: "Water", color: Color(red: 0.2, green: 0.5, blue: 0.8)),
        DreamTheme(name: "Chase", color: Color(red: 0.9, green: 0.3, blue: 0.3)),
        DreamTheme(name: "Lost", color: Color(red: 0.6, green: 0.4, blue: 0.7))
    ]
    @State private var forgottenFragments: [ForgottenFragment] = []
    @State private var decayTimer: Timer?
    @State private var interfaceDecay: Double = 0.0
    @State private var selectedTheme: DreamTheme?
    @State private var isStirring: Bool = false
    @State private var stirPosition: CGPoint = .zero
    
    let decayDuration: TimeInterval = 300 // 5 minutes
    
    var body: some View {
        ZStack {
            // Decaying background
            LinearGradient(
                colors: [
                    Color(red: 0.05 + 0.15 * (1 - interfaceDecay), 
                          green: 0.05 + 0.15 * (1 - interfaceDecay), 
                          blue: 0.1 + 0.2 * (1 - interfaceDecay)),
                    Color(red: 0.02 + 0.08 * (1 - interfaceDecay), 
                          green: 0.02 + 0.08 * (1 - interfaceDecay), 
                          blue: 0.05 + 0.15 * (1 - interfaceDecay))
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            
            // Crystallized dream constellation
            GeometryReader { geo in
                ForEach(entries.filter { $0.isCrystallized }) { entry in
                    CrystalNode(entry: entry, decay: interfaceDecay)
                        .position(entry.position)
                        .transition(.scale.combined(with: .opacity))
                }
                
                // Connection lines between related dreams
                Path { path in
                    let crystallized = entries.filter { $0.isCrystallized }
                    for i in 0..<crystallized.count {
                        for j in i+1..<crystallized.count {
                            if crystallized[i].theme.id == crystallized[j].theme.id {
                                path.move(to: crystallized[i].position)
                                path.addLine(to: crystallized[j].position)
                            }
                        }
                    }
                }
                .stroke(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.2 * (1 - interfaceDecay)),
                            Color.white.opacity(0.05 * (1 - interfaceDecay))
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    ),
                    lineWidth: 1
                )
            }
            
            VStack(spacing: 40) {
                // Title with progressive decay
                Text("DREAM DECAY CALCULATOR")
                    .font(.system(size: 36, weight: .thin, design: .serif))
                    .foregroundColor(Color.white.opacity(1 - interfaceDecay * 0.7))
                    .tracking(interfaceDecay * 20)
                    .offset(y: interfaceDecay * 30)
                    .blur(radius: interfaceDecay * 3)
                
                // Dream input area
                VStack(spacing: 20) {
                    Text("Capture your dream before it fades...")
                        .font(.system(size: 14, weight: .light, design: .default))
                        .foregroundColor(Color.gray.opacity(1 - interfaceDecay))
                        .tracking(interfaceDecay * 5)
                    
                    ZStack {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.white.opacity(0.05 * (1 - interfaceDecay)))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(Color.white.opacity(0.1 * (1 - interfaceDecay)), lineWidth: 1)
                            )
                        
                        TextEditor(text: $currentDream)
                            .font(.system(size: 16, weight: .light, design: .serif))
                            .foregroundColor(Color.white.opacity(1 - interfaceDecay * 0.5))
                            .scrollContentBackground(.hidden)
                            .padding(12)
                            .tracking(interfaceDecay * 8)
                            .offset(y: interfaceDecay * 15)
                    }
                    .frame(height: 200)
                    .scaleEffect(1 - interfaceDecay * 0.1)
                    
                    // Theme selection
                    HStack(spacing: 15) {
                        ForEach(themes) { theme in
                            Button(action: { selectedTheme = theme }) {
                                Text(theme.name)
                                    .font(.system(size: 12, weight: .medium, design: .rounded))
                                    .foregroundColor(selectedTheme?.id == theme.id ? Color.black : theme.color)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 8)
                                    .background(
                                        RoundedRectangle(cornerRadius: 20)
                                            .fill(selectedTheme?.id == theme.id ? 
                                                  theme.color.opacity(1 - interfaceDecay * 0.5) : 
                                                  Color.clear)
                                            .overlay(
                                                RoundedRectangle(cornerRadius: 20)
                                                    .stroke(theme.color.opacity(0.5 * (1 - interfaceDecay)), lineWidth: 1)
                                            )
                                    )
                            }
                        }
                    }
                    .opacity(1 - interfaceDecay * 0.3)
                    
                    // Crystallize button
                    Button(action: crystallizeDream) {
                        Text("CRYSTALLIZE")
                            .font(.system(size: 14, weight: .medium, design: .monospaced))
                            .foregroundColor(Color.white.opacity(1 - interfaceDecay * 0.5))
                            .padding(.horizontal, 30)
                            .padding(.vertical, 12)
                            .background(
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(Color.white.opacity(0.1 * (1 - interfaceDecay)))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 8)
                                            .stroke(Color.white.opacity(0.3 * (1 - interfaceDecay)), lineWidth: 1)
                                    )
                            )
                    }
                    .disabled(currentDream.isEmpty || selectedTheme == nil || interfaceDecay > 0.8)
                }
                .padding(.horizontal, 40)
                
                Spacer()
            }
            .padding(.top, 60)
            
            // Forgotten fragments floating
            ForEach(forgottenFragments) { fragment in
                Text(fragment.text)
                    .font(.system(size: 12, weight: .light, design: .serif))
                    .foregroundColor(Color.white.opacity(fragment.opacity))
                    .position(fragment.position)
                    .transition(.opacity)
            }
        }
        .onAppear {
            startDecayTimer()
        }
        .onDisappear {
            decayTimer?.invalidate()
        }
    }
    
    func crystallizeDream() {
        guard !currentDream.isEmpty, let theme = selectedTheme else { return }
        
        let randomX = CGFloat.random(in: 100...300)
        let randomY = CGFloat.random(in: 100...500)
        
        let newEntry = DreamEntry(
            content: currentDream,
            theme: theme,
            timestamp: Date(),
            isCrystallized: true,
            position: CGPoint(x: randomX, y: randomY)
        )
        
        withAnimation(.easeInOut(duration: 1.0)) {
            entries.append(newEntry)
        }
        
        currentDream = ""
        selectedTheme = nil
        
        // Reset decay timer
        interfaceDecay = 0
        startDecayTimer()
    }
    
    func startDecayTimer() {
        decayTimer?.invalidate()
        decayTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
            withAnimation(.linear(duration: 0.1)) {
                interfaceDecay = min(interfaceDecay + (0.1 / decayDuration), 1.0)
                
                // Generate forgotten fragments
                if Int.random(in: 0...100) < 5 && !currentDream.isEmpty {
                    let words = currentDream.split(separator: " ")
                    if !words.isEmpty {
                        let randomWord = String(words.randomElement() ?? "")
                        let fragment = ForgottenFragment(
                            text: randomWord,
                            opacity: Double.random(in: 0.3...0.7),
                            position: CGPoint(
                                x: CGFloat.random(in: 50...350),
                                y: CGFloat.random(in: 100...600)
                            )
                        )
                        forgottenFragments.append(fragment)
                        
                        // Remove old fragments
                        if forgottenFragments.count > 10 {
                            forgottenFragments.removeFirst()
                        }
                    }
                }
            }
        }
    }
}