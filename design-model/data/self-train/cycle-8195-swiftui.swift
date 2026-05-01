struct ContentView: View {
    @State private var uploadedText: String = ""
    @State private var fragments: [MemoryFragment] = []
    @State private var pathways: [NeuralPathway] = []
    @State private var decayTimer: Timer?
    @State private var currentDecayLevel: Double = 0.0
    @State private var isDecaying: Bool = false
    @State private var reconstructionMode: Bool = false
    @State private var reconstructedText: String = ""
    @State private var selectedFragment: UUID?
    @State private var draggedFragment: MemoryFragment?
    @State private var glitchOffset: CGSize = .zero
    
    let disorderTypes = ["Alzheimer's", "Amnesia", "Dementia", "Aphasia"]
    @State private var selectedDisorder: String = "Alzheimer's"
    
    var body: some View {
        ZStack {
            // Dark, organic background
            Color(red: 0.08, green: 0.08, blue: 0.09)
                .ignoresSafeArea()
            
            // Neural network background
            Canvas { context, size in
                for pathway in pathways {
                    var path = Path()
                    path.move(to: pathway.startPoint)
                    
                    let control1 = CGPoint(
                        x: pathway.startPoint.x + (pathway.endPoint.x - pathway.startPoint.x) * 0.3,
                        y: pathway.startPoint.y + 50
                    )
                    let control2 = CGPoint(
                        x: pathway.endPoint.x - (pathway.endPoint.x - pathway.startPoint.x) * 0.3,
                        y: pathway.endPoint.y - 50
                    )
                    
                    path.addCurve(to: pathway.endPoint, control1: control1, control2: control2)
                    
                    context.stroke(path, with: .color(.white.opacity(pathway.opacity * 0.15)),
                                 lineWidth: pathway.thickness)
                    
                    if pathway.isBreaking {
                        context.stroke(path, with: .color(.red.opacity(pathway.opacity * 0.3)),
                                     lineWidth: pathway.thickness * 1.5)
                    }
                }
            }
            
            if !isDecaying && !reconstructionMode {
                // Input interface
                VStack(spacing: 40) {
                    Text("MEMORY DECAY SIMULATOR")
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .tracking(4)
                        .foregroundColor(.white.opacity(0.6))
                    
                    VStack(spacing: 20) {
                        Text("Enter a memory to decay:")
                            .font(.system(size: 16, weight: .light))
                            .foregroundColor(.white.opacity(0.8))
                        
                        TextEditor(text: $uploadedText)
                            .font(.system(size: 18, weight: .regular, design: .serif))
                            .foregroundColor(.white)
                            .scrollContentBackground(.hidden)
                            .background(Color.white.opacity(0.05))
                            .frame(height: 200)
                            .overlay(
                                RoundedRectangle(cornerRadius: 2)
                                    .stroke(Color.white.opacity(0.2), lineWidth: 1)
                            )
                            .padding(.horizontal, 60)
                        
                        HStack(spacing: 30) {
                            ForEach(disorderTypes, id: \.self) { disorder in
                                Button(action: { selectedDisorder = disorder }) {
                                    Text(disorder)
                                        .font(.system(size: 14, weight: .regular))
                                        .foregroundColor(selectedDisorder == disorder ? .black : .white.opacity(0.7))
                                        .padding(.horizontal, 20)
                                        .padding(.vertical, 8)
                                        .background(
                                            selectedDisorder == disorder ?
                                            Color.white : Color.white.opacity(0.1)
                                        )
                                        .overlay(
                                            Rectangle()
                                                .stroke(Color.white.opacity(0.3), lineWidth: 1)
                                        )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        
                        Button(action: startDecay) {
                            Text("BEGIN DECAY")
                                .font(.system(size: 13, weight: .medium, design: .monospaced))
                                .tracking(2)
                                .foregroundColor(.black)
                                .padding(.horizontal, 40)
                                .padding(.vertical, 12)
                                .background(Color.white)
                                .overlay(
                                    Rectangle()
                                        .stroke(Color.white, lineWidth: 1)
                                )
                        }
                        .buttonStyle(.plain)
                        .disabled(uploadedText.isEmpty)
                    }
                }
                .frame(maxWidth: 800)
                
            } else if isDecaying {
                // Decay visualization
                ZStack {
                    ForEach(fragments) { fragment in
                        MemoryFragmentView(
                            fragment: fragment,
                            isSelected: selectedFragment == fragment.id,
                            glitchOffset: glitchOffset
                        )
                    }
                    
                    VStack {
                        Spacer()
                        
                        // Decay progress
                        VStack(spacing: 10) {
                            Text("DECAY LEVEL: \(Int(currentDecayLevel * 100))%")
                                .font(.system(size: 12, weight: .medium, design: .monospaced))
                                .foregroundColor(.red.opacity(0.8))
                            
                            ProgressView(value: currentDecayLevel)
                                .progressViewStyle(LinearProgressViewStyle())
                                .tint(.red)
                                .frame(width: 300)
                            
                            Button(action: { reconstructionMode = true }) {
                                Text("ATTEMPT RECONSTRUCTION")
                                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                                    .foregroundColor(.white.opacity(0.8))
                                    .padding(.horizontal, 20)
                                    .padding(.vertical, 8)
                                    .background(Color.white.opacity(0.1))
                                    .overlay(
                                        Rectangle()
                                            .stroke(Color.white.opacity(0.3), lineWidth: 1)
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(40)
                    }
                }
                
            } else if reconstructionMode {
                // Reconstruction interface
                VStack(spacing: 40) {
                    Text("MEMORY RECONSTRUCTION")
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .tracking(4)
                        .foregroundColor(.white.opacity(0.6))
                    
                    // Draggable fragments
                    ZStack {
                        ForEach(fragments) { fragment in
                            Text(fragment.text)
                                .font(.system(size: 18, weight: .regular, design: .serif))
                                .foregroundColor(.white.opacity(fragment.opacity))
                                .padding(8)
                                .background(Color.white.opacity(0.1))
                                .overlay(
                                    Rectangle()
                                        .stroke(Color.white.opacity(0.3), lineWidth: 1)
                                )
                                .position(fragment.position)
                                .draggable(fragment)
                        }
                    }
                    .frame(height: 300)
                    
                    // Reconstruction area
                    VStack(spacing: 20) {
                        Text("Reconstructed Memory:")
                            .font(.system(size: 14, weight: .light))
                            .foregroundColor(.white.opacity(0.6))
                        
                        TextEditor(text: $reconstructedText)
                            .font(.system(size: 16, weight: .regular, design: .serif))
                            .foregroundColor(.white)
                            .scrollContentBackground(.hidden)
                            .background(Color.white.opacity(0.05))
                            .frame(height: 100)
                            .overlay(
                                RoundedRectangle(cornerRadius: 2)
                                    .stroke(Color.white.opacity(0.2), lineWidth: 1)
                            )
                            .padding(.horizontal, 60)
                        
                        HStack(spacing: 20) {
                            Button(action: compareMemory) {
                                Text("COMPARE")
                                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 30)
                                    .padding(.vertical, 10)
                                    .background(Color.white.opacity(0.2))
                                    .overlay(
                                        Rectangle()
                                            .stroke(Color.white.opacity(0.4), lineWidth: 1)
                                    )
                            }
                            .buttonStyle(.plain)
                            
                            Button(action: reset) {
                                Text("RESET")
                                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                                    .foregroundColor(.white.opacity(0.6))
                                    .padding(.horizontal, 30)
                                    .padding(.vertical, 10)
                                    .background(Color.white.opacity(0.05))
                                    .overlay(
                                        Rectangle()
                                            .stroke(Color.white.opacity(0.2), lineWidth: 1)
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .frame(maxWidth: 800)
            }
        }
        .onAppear {
            setupGlitchAnimation()
        }
    }
    
    func startDecay() {
        isDecaying = true
        createFragments()
        createPathways()
        
        decayTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
            withAnimation(.easeInOut(duration: 0.2)) {
                currentDecayLevel = min(currentDecayLevel + 0.01, 1.0)
                applyDecay()
                
                if currentDecayLevel >= 1.0 {
                    decayTimer?.invalidate()
                }
            }
        }
    }
    
    func createFragments() {
        let words = uploadedText.split(separator: " ")
        let gridColumns = 5
        let spacing: CGFloat = 120
        let startX: CGFloat = 400
        let startY: CGFloat = 200
        
        for (index, word) in words.enumerated() {
            let row = index / gridColumns
            let col = index % gridColumns
            
            let fragment = MemoryFragment(
                text: String(word),
                position: CGPoint(
                    x: startX + CGFloat(col) * spacing,
                    y: startY + CGFloat(row) * 80
                ),
                opacity: 1.0,
                rotation: 0,
                scale: 1.0,
                isDecaying: false,
                glitchIntensity: 0
            )
            fragments.append(fragment)
        }
    }
    
    func createPathways() {
        for _ in 0..<20 {
            let pathway = NeuralPathway(
                startPoint: CGPoint(
                    x: CGFloat.random(in: 0...1200),
                    y: CGFloat.random(in: 0...800)
                ),
                endPoint: CGPoint(
                    x: CGFloat.random(in: 0...1200),
                    y: CGFloat.random(in: 0...800)
                ),
                opacity: Double.random(in: 0.3...0.8),
                thickness: CGFloat.random(in: 1...3),
                isBreaking: false
            )
            pathways.append(pathway)
        }
    }
    
    func applyDecay() {
        let decayRate = getDecayRate(for: selectedDisorder)
        
        for index in fragments.indices {
            if Double.random(in: 0...1) < decayRate * currentDecayLevel {
                fragments[index].opacity = max(0.1, fragments[index].opacity - 0.05)
                fragments[index].rotation = Double.random(in: -10...10)
                fragments[index].scale = Double.random(in: 0.8...1.2)
                fragments[index].isDecaying = true
                fragments[index].glitchIntensity = Double.random(in: 0...currentDecayLevel)
                
                // Random position drift
                fragments[index].position.x += CGFloat.random(in: -5...5)
                fragments[index].position.y += CGFloat.random(in: -5...5)
            }
        }
        
        // Break pathways
        for index in pathways.indices {
            if Double.random(in: 0...1) < currentDecayLevel * 0.3 {
                pathways[index].isBreaking = true
                pathways[index].opacity = max(0.1, pathways[index].opacity - 0.1)
            }
        }
    }
    
    func getDecayRate(for disorder: String) -> Double {
        switch disorder {
        case "Alzheimer's": return 0.15
        case "Amnesia": return 0.25
        case "Dementia": return 0.20
        case "Aphasia": return 0.18
        default: return 0.15
        }
    }
    
    func setupGlitchAnimation() {
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            withAnimation(.easeInOut(duration: 0.1)) {
                glitchOffset = CGSize(
                    width: CGFloat.random(in: -2...2),
                    height: CGFloat.random(in: -2...2)
                )
            }
        }
    }
    
    func compareMemory() {
        let similarity = calculateSimilarity(original: uploadedText, reconstructed: reconstructedText)
        print("Memory integrity: \(Int(similarity * 100))%")
    }
    
    func calculateSimilarity(original: String, reconstructed: String) -> Double {
        let originalWords = Set(original.lowercased().split(separator: " ").map { String($0) })
        let reconstructedWords = Set(reconstructed.lowercased().split(separator: " ").map { String($0) })
        
        let intersection = originalWords.intersection(reconstructedWords)
        let union = originalWords.union(reconstructedWords)
        
        return union.isEmpty ? 0 : Double(intersection.count) / Double(union.count)
    }
    
    func reset() {
        uploadedText = ""
        fragments = []
        pathways = []
        currentDecayLevel = 0.0
        isDecaying = false
        reconstructionMode = false
        reconstructedText = ""
        selectedFragment = nil
        draggedFragment = nil
        decayTimer?.invalidate()
        decayTimer = nil
    }
}