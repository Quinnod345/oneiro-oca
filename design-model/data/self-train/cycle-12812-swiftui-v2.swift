struct ContentView: View {
    @State private var memoryText: String = ""
    @State private var fragments: [MemoryFragment] = []
    @State private var decayProgress: Double = 0.0
    @State private var isProcessing: Bool = false
    @State private var showingInput: Bool = true
    @State private var currentPhase: DecayPhase = .intact
    
    let emotionalAnchors = ["love", "first", "last", "never", "always", "mother", "father", "child", "death", "birth", "kiss", "goodbye", "forever", "heart", "soul", "dream", "hope", "fear", "joy", "pain"]
    
    enum DecayPhase {
        case intact, fading, fragmenting, lost
        
        var gradient: [Color] {
            switch self {
            case .intact:
                return [Color(#colorLiteral(red: 0.1019607843, green: 0.1137254902, blue: 0.1725490196, alpha: 1)), Color(#colorLiteral(red: 0.1411764706, green: 0.1607843137, blue: 0.2509803922, alpha: 1))]
            case .fading:
                return [Color(#colorLiteral(red: 0.1215686275, green: 0.1294117647, blue: 0.1843137255, alpha: 1)), Color(#colorLiteral(red: 0.1803921569, green: 0.1921568627, blue: 0.2705882353, alpha: 1))]
            case .fragmenting:
                return [Color(#colorLiteral(red: 0.1568627451, green: 0.1607843137, blue: 0.2039215686, alpha: 1)), Color(#colorLiteral(red: 0.2352941176, green: 0.2392156863, blue: 0.3058823529, alpha: 1))]
            case .lost:
                return [Color(#colorLiteral(red: 0.2156862745, green: 0.2156862745, blue: 0.2431372549, alpha: 1)), Color(#colorLiteral(red: 0.3215686275, green: 0.3215686275, blue: 0.3647058824, alpha: 1))]
            }
        }
    }
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                LinearGradient(
                    colors: currentPhase.gradient,
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()
                .animation(.easeInOut(duration: 3), value: currentPhase)
                
                if showingInput {
                    VStack(spacing: geometry.size.height * 0.05) {
                        VStack(spacing: 8) {
                            Text("Memory")
                                .font(.system(size: min(geometry.size.width * 0.12, 48), weight: .ultraLight, design: .serif))
                                .foregroundStyle(
                                    LinearGradient(
                                        colors: [.white.opacity(0.9), .white.opacity(0.6)],
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    )
                                )
                            
                            Text("What fades when we forget?")
                                .font(.system(size: min(geometry.size.width * 0.04, 16), weight: .light, design: .serif))
                                .foregroundColor(.white.opacity(0.5))
                        }
                        .padding(.top, geometry.safeAreaInsets.top + 40)
                        
                        VStack(spacing: 24) {
                            ZStack(alignment: .topLeading) {
                                if memoryText.isEmpty {
                                    Text("Share a memory...")
                                        .font(.system(size: 17, design: .serif))
                                        .foregroundColor(.white.opacity(0.3))
                                        .padding(.horizontal, 8)
                                        .padding(.top, 8)
                                }
                                
                                TextEditor(text: $memoryText)
                                    .font(.system(size: 17, design: .serif))
                                    .foregroundColor(.white)
                                    .scrollContentBackground(.hidden)
                                    .tint(.white.opacity(0.6))
                                    .padding(4)
                            }
                            .frame(maxWidth: min(geometry.size.width - 40, 600))
                            .frame(height: geometry.size.height * 0.25)
                            .background(
                                RoundedRectangle(cornerRadius: 16)
                                    .fill(.ultraThinMaterial.opacity(0.5))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 16)
                                    .strokeBorder(
                                        LinearGradient(
                                            colors: [.white.opacity(0.2), .white.opacity(0.05)],
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        ),
                                        lineWidth: 1
                                    )
                            )
                            
                            Button(action: processMemory) {
                                HStack(spacing: 12) {
                                    Text("Watch it fade")
                                        .font(.system(size: 16, weight: .medium, design: .serif))
                                    
                                    Image(systemName: "sparkles")
                                        .font(.system(size: 14))
                                        .symbolEffect(.pulse)
                                }
                                .foregroundColor(.white.opacity(0.9))
                                .padding(.horizontal, 32)
                                .padding(.vertical, 16)
                                .background(
                                    Capsule()
                                        .fill(.ultraThinMaterial.opacity(0.3))
                                        .overlay(
                                            Capsule()
                                                .strokeBorder(
                                                    LinearGradient(
                                                        colors: [.white.opacity(0.3), .white.opacity(0.1)],
                                                        startPoint: .leading,
                                                        endPoint: .trailing
                                                    ),
                                                    lineWidth: 1
                                                )
                                        )
                                )
                            }
                            .disabled(memoryText.isEmpty || isProcessing)
                            .opacity(memoryText.isEmpty ? 0.4 : 1)
                        }
                        .padding(.horizontal)
                        
                        Spacer()
                    }
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
                }
                
                if !fragments.isEmpty {
                    ForEach(fragments) { fragment in
                        MemoryFragmentView(
                            fragment: fragment,
                            decayProgress: decayProgress,
                            screenSize: geometry.size
                        )
                    }
                    
                    VStack {
                        Spacer()
                        
                        HStack(spacing: 16) {
                            ForEach(0..<3) { i in
                                Circle()
                                    .fill(.white.opacity(0.1 + (0.1 * sin(decayProgress * .pi + Double(i)))))
                                    .frame(width: 3, height: 3)
                            }
                        }
                        .padding(.bottom, geometry.safeAreaInsets.bottom + 20)
                    }
                }
            }
        }
    }
    
    func processMemory() {
        withAnimation(.easeOut(duration: 0.6)) {
            showingInput = false
        }
        
        isProcessing = true
        let words = memoryText.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            createFragments(from: words)
            startDecayAnimation()
        }
    }
    
    func createFragments(from words: [String]) {
        fragments = []
        
        for (index, word) in words.enumerated() {
            let importance = emotionalAnchors.contains(word.lowercased()) ? Double.random(in: 0.7...1.0) : Double.random(in: 0.3...0.7)
            
            let fragment = MemoryFragment(
                text: word,
                importance: importance,
                initialDelay: Double(index) * 0.05
            )
            
            fragments.append(fragment)
        }
    }
    
    func startDecayAnimation() {
        withAnimation(.linear(duration: 0.5)) {
            currentPhase = .fading
        }
        
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { timer in
            decayProgress += 0.005
            
            if decayProgress > 0.3 && currentPhase == .fading {
                withAnimation(.easeInOut(duration: 2)) {
                    currentPhase = .fragmenting
                }
            } else if decayProgress > 0.7 && currentPhase == .fragmenting {
                withAnimation(.easeInOut(duration: 2)) {
                    currentPhase = .lost
                }
            }
            
            if decayProgress >= 1.0 {
                timer.invalidate()
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                    resetExperience()
                }
            }
        }
    }
    
    func resetExperience() {
        withAnimation(.easeInOut(duration: 1)) {
            showingInput = true
            fragments = []
            decayProgress = 0
            memoryText = ""
            isProcessing = false
            currentPhase = .intact
        }
    }
}

struct MemoryFragment: Identifiable {
    let id = UUID()
    let text: String
    let importance: Double
    let initialDelay: Double
    
    var opacity: Double = 1.0
    var blur: Double = 0.0
    var position: CGPoint = .zero
    var drift: CGPoint = .zero
    var rotation: Angle = .zero
}

struct MemoryFragmentView: View {
    let fragment: MemoryFragment
    let decayProgress: Double
    let screenSize: CGSize
    
    @State private var position: CGPoint = .zero
    @State private var opacity: Double = 1.0
    @State private var scale: Double = 1.0
    @State private var rotation: Angle = .zero
    
    var body: some View {
        Text(fragment.text)
            .font(.system(
                size: 16 + (fragment.importance * 12),
                weight: fragment.importance > 0.7 ? .light : .ultraLight,
                design: .serif
            ))
            .foregroundStyle(
                LinearGradient(
                    colors: [
                        .white.opacity(opacity * (1 - decayProgress * 0.3)),
                        .white.opacity(opacity * 0.6 * (1 - decayProgress * 0.5))
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .blur(radius: decayProgress * 8 * (2 - fragment.importance))
            .scaleEffect(scale)
            .rotationEffect(rotation)
            .position(position)
            .onAppear {
                position = CGPoint(
                    x: CGFloat.random(in: screenSize.width * 0.1...screenSize.width * 0.9),
                    y: CGFloat.random(in: screenSize.height * 0.2...screenSize.height * 0.7)
                )
                
                withAnimation(
                    .spring(
                        response: 2 + fragment.importance,
                        dampingFraction: 0.6,
                        blendDuration: 1
                    )
                    .delay(fragment.initialDelay)
                ) {
                    scale = 1.0 + (fragment.importance * 0.2)
                }
                
                animateDecay()
            }
    }
    
    func animateDecay() {
        Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { timer in
            withAnimation(.spring(response: 3, dampingFraction: 0.7)) {
                position.x += CGFloat.random(in: -2...2) * (1 + decayProgress * 3)
                position.y += (2 - fragment.importance) * 2 * (1 + decayProgress * 2)
                
                opacity = max(0, fragment.importance - (decayProgress * (2 - fragment.importance)))
                scale = 1.0 + (fragment.importance * 0.2) - (decayProgress * 0.3)
                rotation = Angle(degrees: Double.random(in: -5...5) * decayProgress)
            }
            
            if decayProgress >= 1.0 {
                timer.invalidate()
            }
        }
    }
}