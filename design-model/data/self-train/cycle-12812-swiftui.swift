struct ContentView: View {
    @State private var memoryText: String = ""
    @State private var fragments: [MemoryFragment] = []
    @State private var decayProgress: Double = 0.0
    @State private var isProcessing: Bool = false
    @State private var glassOpacity: Double = 0.3
    @State private var focusPoint: CGPoint = .zero
    
    let emotionalAnchors = ["love", "first", "last", "never", "always", "mother", "father", "child", "death", "birth", "kiss", "goodbye", "forever", "heart", "soul", "dream", "hope", "fear", "joy", "pain"]
    
    var body: some View {
        ZStack {
            Color(red: 0.05, green: 0.05, blue: 0.08)
                .ignoresSafeArea()
            
            if !fragments.isEmpty {
                GeometryReader { geometry in
                    ZStack {
                        // Frosted glass overlay
                        Rectangle()
                            .fill(Color.white.opacity(glassOpacity * 0.05))
                            .blur(radius: 20 + (decayProgress * 30))
                        
                        // Memory fragments
                        ForEach(fragments) { fragment in
                            Text(fragment.text)
                                .font(.system(size: 14 + (fragment.importance * 8), weight: fragment.importance > 0.7 ? .medium : .regular, design: .serif))
                                .foregroundColor(Color.white.opacity(fragment.opacity))
                                .blur(radius: fragment.blur)
                                .position(
                                    x: fragment.position.x + fragment.drift.x,
                                    y: fragment.position.y + fragment.drift.y
                                )
                                .animation(.easeOut(duration: 2.5), value: fragment.drift)
                        }
                        
                        // Particle system for forgotten fragments
                        ForEach(0..<Int(decayProgress * 50), id: \.self) { i in
                            Circle()
                                .fill(Color.white.opacity(0.1 - (decayProgress * 0.08)))
                                .frame(width: 2, height: 2)
                                .position(
                                    x: CGFloat.random(in: 0...geometry.size.width),
                                    y: geometry.size.height - CGFloat(i) * 5 * (1 + decayProgress)
                                )
                                .blur(radius: 1)
                        }
                    }
                    .onAppear {
                        focusPoint = CGPoint(x: geometry.size.width / 2, y: geometry.size.height / 2)
                    }
                }
            } else {
                VStack(spacing: 40) {
                    Text("MEMORY DECAY SIMULATOR")
                        .font(.system(size: 28, weight: .thin, design: .serif))
                        .foregroundColor(.white)
                        .opacity(0.9)
                        .tracking(8)
                    
                    VStack(alignment: .leading, spacing: 20) {
                        Text("Enter a cherished memory:")
                            .font(.system(size: 14, weight: .regular, design: .serif))
                            .foregroundColor(.white)
                            .opacity(0.7)
                        
                        ZStack(alignment: .topLeading) {
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.white.opacity(0.2), lineWidth: 1)
                                .background(Color.white.opacity(0.05))
                            
                            TextEditor(text: $memoryText)
                                .font(.system(size: 16, design: .serif))
                                .foregroundColor(.white)
                                .scrollContentBackground(.hidden)
                                .padding(12)
                                .frame(height: 200)
                        }
                        .frame(width: 600)
                        
                        Button(action: processMemory) {
                            Text("Begin Decay")
                                .font(.system(size: 14, weight: .medium, design: .serif))
                                .foregroundColor(Color(red: 0.05, green: 0.05, blue: 0.08))
                                .padding(.horizontal, 40)
                                .padding(.vertical, 12)
                                .background(Color.white.opacity(0.9))
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                        .disabled(memoryText.isEmpty || isProcessing)
                        .opacity(memoryText.isEmpty ? 0.5 : 1)
                    }
                }
            }
            
            if !fragments.isEmpty {
                VStack {
                    Spacer()
                    
                    HStack(spacing: 40) {
                        Button(action: { fragments = []; decayProgress = 0; memoryText = "" }) {
                            Text("New Memory")
                                .font(.system(size: 12, weight: .medium, design: .serif))
                                .foregroundColor(.white)
                                .opacity(0.7)
                        }
                        
                        HStack(spacing: 20) {
                            Text("INTACT")
                                .font(.system(size: 10, weight: .regular, design: .serif))
                                .foregroundColor(.white)
                                .opacity(0.5)
                            
                            Slider(value: $decayProgress, in: 0...1)
                                .frame(width: 300)
                                .accentColor(.white)
                                .onChange(of: decayProgress) { _ in
                                    updateDecay()
                                }
                            
                            Text("FORGOTTEN")
                                .font(.system(size: 10, weight: .regular, design: .serif))
                                .foregroundColor(.white)
                                .opacity(0.5)
                        }
                    }
                    .padding(.bottom, 40)
                }
            }
        }
    }
    
    func processMemory() {
        isProcessing = true
        let words = memoryText.split(separator: " ").map { String($0) }
        
        fragments = []
        
        for (index, word) in words.enumerated() {
            let importance = emotionalAnchors.contains(word.lowercased()) ? 0.9 : Double.random(in: 0.3...0.7)
            
            let fragment = MemoryFragment(
                text: word,
                position: CGPoint(
                    x: CGFloat.random(in: 100...700),
                    y: CGFloat.random(in: 100...500)
                ),
                opacity: 0.9,
                blur: 0,
                importance: importance
            )
            
            fragments.append(fragment)
        }
        
        isProcessing = false
    }
    
    func updateDecay() {
        for index in fragments.indices {
            let importance = fragments[index].importance
            let resistanceToDecay = importance * 0.5
            
            fragments[index].opacity = max(0.1, 1.0 - (decayProgress * (1 - resistanceToDecay)))
            fragments[index].blur = CGFloat(decayProgress * 10 * (1 - importance))
            
            fragments[index].drift = CGPoint(
                x: CGFloat.random(in: -50...50) * decayProgress,
                y: CGFloat.random(in: -30...30) * decayProgress
            )
        }
        
        glassOpacity = 0.3 + (decayProgress * 0.4)
    }
}