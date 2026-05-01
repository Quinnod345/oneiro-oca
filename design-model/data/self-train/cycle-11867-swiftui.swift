struct ContentView: View {
    @State private var currentText: String = ""
    @State private var formations: [CrystalFormation] = []
    @State private var dragOffset: CGSize = .zero
    @State private var timer: Timer?
    @State private var sendProgress: Double = 0
    @State private var isSending: Bool = false
    
    let emotionalWeights = [
        "sorry": 0.9, "regret": 0.85, "hurt": 0.8, "pain": 0.75,
        "forgive": 0.7, "mistake": 0.65, "wrong": 0.6, "fault": 0.55,
        "hope": 0.3, "better": 0.25, "understand": 0.35, "care": 0.2
    ]
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color(red: 0.98, green: 0.98, blue: 0.99)
                    .ignoresSafeArea()
                
                ForEach(formations) { formation in
                    CrystalView(formation: formation)
                        .position(formation.position)
                        .scaleEffect(formation.scale)
                        .rotationEffect(.degrees(formation.rotation))
                        .opacity(formation.opacity)
                }
                
                VStack {
                    Spacer()
                    
                    ZStack {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Color.white.opacity(0.95))
                            .frame(height: 120)
                            .overlay(
                                RoundedRectangle(cornerRadius: 2)
                                    .strokeBorder(Color(red: 0.9, green: 0.9, blue: 0.92), lineWidth: 1)
                            )
                        
                        TextEditor(text: $currentText)
                            .font(.system(size: 18, weight: .light, design: .serif))
                            .foregroundColor(Color.black.opacity(0.7))
                            .scrollContentBackground(.hidden)
                            .background(Color.clear)
                            .padding(20)
                            .onChange(of: currentText) { oldValue, newValue in
                                processTextChange(oldValue: oldValue, newValue: newValue, in: geometry.size)
                            }
                    }
                    .padding(.horizontal, 40)
                    .padding(.bottom, 40)
                }
                
                if isSending {
                    VStack {
                        Spacer()
                        Text("letting go...")
                            .font(.system(size: 14, weight: .light, design: .serif))
                            .foregroundColor(Color.black.opacity(0.3))
                            .padding(.bottom, 200)
                    }
                }
            }
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            startDissolutionTimer()
        }
    }
    
    func processTextChange(oldValue: String, newValue: String, in size: CGSize) {
        guard newValue.count > oldValue.count else { return }
        
        let newChar = String(newValue.suffix(1))
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
            text: newChar,
            weight: weight,
            in: size
        )
        
        formations.append(formation)
        
        if formations.count > 50 {
            formations.removeFirst()
        }
    }
    
    func createCrystalFormation(text: String, weight: Double, in size: CGSize) -> CrystalFormation {
        let baseY = size.height - 160
        let targetY = baseY - (1.0 - weight) * (size.height - 200)
        
        let vertices = generateCrystalVertices(weight: weight)
        
        return CrystalFormation(
            text: text,
            position: CGPoint(
                x: Double.random(in: 100...(size.width - 100)),
                y: targetY
            ),
            weight: weight,
            opacity: 0.8,
            scale: 0.8 + weight * 0.4,
            rotation: Double.random(in: -15...15),
            vertices: vertices,
            dissolveProgress: 0
        )
    }
    
    func generateCrystalVertices(weight: Double) -> [CGPoint] {
        let _ = Int.random(in: 4...8)
        let complexity = weight > 0.7 ? 12 : 8
        var vertices: [CGPoint] = []
        
        for i in 0..<complexity {
            let angle = (Double(i) / Double(complexity)) * .pi * 2
            let radius = 20.0 + weight * 30.0 + Double.random(in: -5...5)
            vertices.append(CGPoint(
                x: cos(angle) * radius,
                y: sin(angle) * radius
            ))
        }
        
        return vertices
    }
    
    func startDissolutionTimer() {
        timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            var hasFullyDissolved = false
            
            for i in formations.indices {
                formations[i].dissolveProgress += 0.008
                formations[i].opacity *= 0.995
                formations[i].position.y += formations[i].weight * 0.5
                
                if formations[i].dissolveProgress > 0.5 {
                    formations[i].scale *= 0.98
                    formations[i].rotation += formations[i].weight * 0.3
                }
                
                if formations[i].opacity < 0.01 {
                    hasFullyDissolved = true
                }
            }
            
            formations.removeAll { $0.opacity < 0.01 }
            
            if hasFullyDissolved && formations.isEmpty && !currentText.isEmpty && !isSending {
                sendMessage()
            }
        }
    }
    
    func sendMessage() {
        isSending = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            currentText = ""
            isSending = false
        }
    }
}