struct ContentView: View {
    @State private var currentText: String = ""
    @State private var formations: [CrystalFormation] = []
    @State private var compositionPhase: CompositionPhase = .writing
    @State private var sendProgress: Double = 0
    @State private var selectedFormation: CrystalFormation?
    
    enum CompositionPhase {
        case writing
        case crystallized
        case releasing
        case complete
    }
    
    let emotionalWeights = [
        "sorry": 0.9, "regret": 0.85, "hurt": 0.8, "pain": 0.75,
        "forgive": 0.7, "mistake": 0.65, "wrong": 0.6, "fault": 0.55,
        "hope": 0.3, "better": 0.25, "understand": 0.35, "care": 0.2
    ]
    
    var dominantEmotion: (String, Double) {
        var maxWeight = ("neutral", 0.5)
        let words = currentText.lowercased().split(separator: " ")
        
        for word in words {
            for (key, value) in emotionalWeights {
                if String(word).contains(key) {
                    if value > maxWeight.1 {
                        maxWeight = (key, value)
                    }
                }
            }
        }
        return maxWeight
    }
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Dynamic gradient background based on emotional weight
                LinearGradient(
                    colors: backgroundColors(for: dominantEmotion.1),
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()
                .animation(.easeInOut(duration: 1.5), value: dominantEmotion.1)
                
                // Crystal formations layer
                ForEach(formations) { formation in
                    CrystalView(formation: formation)
                        .position(formation.position)
                        .scaleEffect(formation.scale)
                        .rotationEffect(.degrees(formation.rotation))
                        .opacity(formation.opacity)
                        .blur(radius: selectedFormation?.id == formation.id ? 0 : 2)
                        .onTapGesture {
                            withAnimation(.spring(response: 0.4)) {
                                selectedFormation = selectedFormation?.id == formation.id ? nil : formation
                            }
                        }
                }
                
                VStack(spacing: 0) {
                    // Header
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Emotional Crystallization")
                            .font(.system(size: 32, weight: .light, design: .serif))
                            .foregroundColor(.white)
                        
                        Text(phaseDescription)
                            .font(.system(size: 16, weight: .light))
                            .foregroundColor(.white.opacity(0.8))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 60)
                    .padding(.top, 60)
                    
                    Spacer()
                    
                    // Text input area
                    VStack(spacing: 24) {
                        if compositionPhase == .writing || compositionPhase == .crystallized {
                            ZStack {
                                RoundedRectangle(cornerRadius: 16)
                                    .fill(.ultraThinMaterial)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 16)
                                            .strokeBorder(Color.white.opacity(0.2), lineWidth: 1)
                                    )
                                
                                TextEditor(text: $currentText)
                                    .font(.system(size: 20, weight: .regular, design: .serif))
                                    .foregroundColor(.white)
                                    .scrollContentBackground(.hidden)
                                    .background(Color.clear)
                                    .padding(24)
                                    .disabled(compositionPhase != .writing)
                                    .onChange(of: currentText) { oldValue, newValue in
                                        processTextChange(oldValue: oldValue, newValue: newValue, in: geometry.size)
                                    }
                                
                                if currentText.isEmpty {
                                    Text("Write your emotional message...")
                                        .font(.system(size: 20, weight: .light, design: .serif))
                                        .foregroundColor(.white.opacity(0.5))
                                        .allowsHitTesting(false)
                                        .padding(24)
                                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                                }
                            }
                            .frame(height: 160)
                            .shadow(color: .black.opacity(0.1), radius: 20, x: 0, y: 10)
                        }
                        
                        // Action buttons
                        HStack(spacing: 16) {
                            if compositionPhase == .crystallized {
                                Button(action: { 
                                    withAnimation(.easeInOut(duration: 0.5)) {
                                        compositionPhase = .writing
                                        currentText = ""
                                        formations.removeAll()
                                    }
                                }) {
                                    Label("Start Over", systemImage: "arrow.counterclockwise")
                                        .font(.system(size: 16, weight: .medium))
                                        .foregroundColor(.white.opacity(0.8))
                                        .padding(.horizontal, 24)
                                        .padding(.vertical, 12)
                                        .background(
                                            Capsule()
                                                .fill(Color.white.opacity(0.1))
                                                .overlay(
                                                    Capsule()
                                                        .strokeBorder(Color.white.opacity(0.2), lineWidth: 1)
                                                )
                                        )
                                }
                                
                                Button(action: releaseFormations) {
                                    Label("Release", systemImage: "sparkles")
                                        .font(.system(size: 16, weight: .medium))
                                        .foregroundColor(.black)
                                        .padding(.horizontal, 32)
                                        .padding(.vertical, 12)
                                        .background(
                                            Capsule()
                                                .fill(Color.white)
                                                .shadow(color: .white.opacity(0.3), radius: 10)
                                        )
                                }
                            }
                        }
                        .opacity(compositionPhase == .crystallized ? 1 : 0)
                        .animation(.easeInOut, value: compositionPhase)
                    }
                    .padding(.horizontal, 60)
                    .padding(.bottom, 80)
                    
                    // Crystallize button
                    if compositionPhase == .writing && !currentText.isEmpty {
                        Button(action: crystallize) {
                            Text("Crystallize")
                                .font(.system(size: 18, weight: .medium))
                                .foregroundColor(.white)
                                .padding(.horizontal, 40)
                                .padding(.vertical, 16)
                                .background(
                                    Capsule()
                                        .fill(
                                            LinearGradient(
                                                colors: [Color.white.opacity(0.2), Color.white.opacity(0.1)],
                                                startPoint: .leading,
                                                endPoint: .trailing
                                            )
                                        )
                                        .overlay(
                                            Capsule()
                                                .strokeBorder(Color.white.opacity(0.3), lineWidth: 1)
                                        )
                                )
                        }
                        .padding(.bottom, 40)
                        .transition(.opacity.combined(with: .scale))
                    }
                }
                
                // Phase indicator overlay
                if compositionPhase == .releasing {
                    Color.white.opacity(sendProgress * 0.8)
                        .ignoresSafeArea()
                        .allowsHitTesting(false)
                }
            }
        }
        .frame(width: 1440, height: 900)
    }
    
    var phaseDescription: String {
        switch compositionPhase {
        case .writing:
            return "Transform your words into crystalline forms"
        case .crystallized:
            return "Your emotions have taken shape - \(dominantEmotion.0)"
        case .releasing:
            return "Releasing into the universe..."
        case .complete:
            return "Your message has been released"
        }
    }
    
    func backgroundColors(for weight: Double) -> [Color] {
        if weight > 0.7 {
            return [
                Color(red: 0.2, green: 0.1, blue: 0.3),
                Color(red: 0.4, green: 0.2, blue: 0.5)
            ]
        } else if weight > 0.5 {
            return [
                Color(red: 0.3, green: 0.2, blue: 0.4),
                Color(red: 0.5, green: 0.3, blue: 0.6)
            ]
        } else {
            return [
                Color(red: 0.4, green: 0.5, blue: 0.7),
                Color(red: 0.6, green: 0.7, blue: 0.9)
            ]
        }
    }
    
    func processTextChange(oldValue: String, newValue: String, in size: CGSize) {
        guard newValue.count > oldValue.count,
              compositionPhase == .writing,
              formations.count < 10 else { return }
        
        let words = newValue.lowercased().split(separator: " ")
        var weight = 0.5
        
        for word in words {
            for (key, value) in emotionalWeights {
                if String(word).contains(key) {
                    weight = max(weight, value)
                }
            }
        }
        
        let formation = createCrystalFormation(
            text: String(newValue.suffix(1)),
            weight: weight,
            in: size
        )
        
        withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
            formations.append(formation)
        }
    }
    
    func createCrystalFormation(text: String, weight: Double, in size: CGSize) -> CrystalFormation {
        let centerX = size.width / 2
        let centerY = size.height / 2 - 100
        let radius = 200.0
        let angle = Double(formations.count) * (.pi * 2 / 10)
        
        let vertices = generateCrystalVertices(weight: weight)
        
        return CrystalFormation(
            text: text,
            position: CGPoint(
                x: centerX + cos(angle) * radius * (0.5 + weight * 0.5),
                y: centerY + sin(angle) * radius * 0.3
            ),
            weight: weight,
            opacity: 0.9,
            scale: 0.6 + weight * 0.4,
            rotation: angle * 180 / .pi,
            vertices: vertices,
            dissolveProgress: 0
        )
    }
    
    func generateCrystalVertices(weight: Double) -> [CGPoint] {
        let basePoints = 6
        var vertices: [CGPoint] = []
        
        for i in 0..<basePoints {
            let angle = (Double(i) / Double(basePoints)) * .pi * 2
            let radius = 30.0 + weight * 20.0
            let variation = weight > 0.7 ? Double.random(in: -5...5) : 0
            
            vertices.append(CGPoint(
                x: cos(angle) * (radius + variation),
                y: sin(angle) * (radius + variation)
            ))
        }
        
        return vertices
    }
    
    func crystallize() {
        withAnimation(.easeInOut(duration: 0.8)) {
            compositionPhase = .crystallized
        }
    }
    
    func releaseFormations() {
        compositionPhase = .releasing
        
        for (index, _) in formations.enumerated() {
            withAnimation(.easeInOut(duration: 2.0).delay(Double(index) * 0.1)) {
                formations[index].opacity = 0
                formations[index].position.y -= 200
                formations[index].scale *= 1.5
            }
        }
        
        withAnimation(.easeInOut(duration: 1.0)) {
            sendProgress = 1.0
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
            withAnimation {
                compositionPhase = .complete
                sendProgress = 0
            }
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                withAnimation {
                    compositionPhase = .writing
                    currentText = ""
                    formations.removeAll()
                }
            }
        }
    }
}

struct CrystalFormation: Identifiable {
    let id = UUID()
    let text: String
    var position: CGPoint
    let weight: Double
    var opacity: Double
    var scale: Double
    var rotation: Double
    let vertices: [CGPoint]
    var dissolveProgress: Double
}

struct CrystalView: View {
    let formation: CrystalFormation
    
    var body: some View {
        ZStack {
            // Crystal shape
            Path { path in
                guard !formation.vertices.isEmpty else { return }
                path.move(to: formation.vertices[0])
                for vertex in formation.vertices.dropFirst() {
                    path.addLine(to: vertex)
                }
                path.closeSubpath()
            }
            .fill(
                LinearGradient(
                    colors: crystalColors,
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                Path { path in
                    guard !formation.vertices.isEmpty else { return }
                    path.move(to: formation.vertices[0])
                    for vertex in formation.vertices.dropFirst() {
                        path.addLine(to: vertex)
                    }
                    path.closeSubpath()
                }
                .stroke(
                    LinearGradient(
                        colors: [Color.white.opacity(0.6), Color.white.opacity(0.2)],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    lineWidth: 1
                )
            )
            .shadow(color: shadowColor, radius: 10, x: 0, y: 5)
            .blur(radius: formation.dissolveProgress * 10)
            
            // Character in center
            Text(formation.text)
                .font(.system(size: 24, weight: .light, design: .serif))
                .foregroundColor(.white)
        }
    }
    
    var crystalColors: [Color] {
        if formation.weight > 0.7 {
            return [
                Color(red: 0.6, green: 0.2, blue: 0.4).opacity(0.8),
                Color(red: 0.8, green: 0.3, blue: 0.5).opacity(0.6)
            ]
        } else if formation.weight > 0.5 {
            return [
                Color(red: 0.5, green: 0.3, blue: 0.6).opacity(0.8),
                Color(red: 0.7, green: 0.4, blue: 0.8).opacity(0.6)
            ]
        } else {
            return [
                Color(red: 0.4, green: 0.6, blue: 0.9).opacity(0.8),
                Color(red: 0.6, green: 0.8, blue: 1.0).opacity(0.6)
            ]
        }
    }
    
    var shadowColor: Color {
        if formation.weight > 0.7 {
            return Color.purple.opacity(0.4)
        } else {
            return Color.blue.opacity(0.3)
        }
    }
}