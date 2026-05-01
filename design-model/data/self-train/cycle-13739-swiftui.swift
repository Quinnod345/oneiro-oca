struct ContentView: View {
    @State private var memories: [PolaroidMemory] = []
    @State private var particles: [MemoryParticle] = []
    @State private var heartbeatScale: CGFloat = 1.0
    @State private var heartbeatOpacity: Double = 0.15
    @State private var mouseLocation: CGPoint = .zero
    @State private var lastMouseLocation: CGPoint = .zero
    @State private var shakeVelocity: CGFloat = 0
    @State private var selectedMemory: UUID?
    @State private var memoryInputs: [UUID: String] = [:]
    
    let memoryImages = [
        "summer afternoon by the lake",
        "grandmother's kitchen",
        "first day of school",
        "wedding dance floor",
        "childhood bedroom",
        "family road trip"
    ]
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Deep void background
                Color.black
                    .ignoresSafeArea()
                
                // Particle field
                ForEach(particles) { particle in
                    Circle()
                        .fill(Color.white.opacity(particle.opacity))
                        .frame(width: particle.size, height: particle.size)
                        .position(particle.position)
                }
                
                // Heartbeat indicator
                Circle()
                    .fill(RadialGradient(
                        colors: [
                            Color(red: 0.8, green: 0.1, blue: 0.1).opacity(heartbeatOpacity),
                            Color.clear
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: 200
                    ))
                    .frame(width: 400 * heartbeatScale, height: 400 * heartbeatScale)
                    .position(x: geometry.size.width / 2, y: geometry.size.height / 2)
                    .allowsHitTesting(false)
                
                // Floating polaroids
                ForEach(memories) { memory in
                    PolaroidView(
                        memory: memory,
                        isSelected: selectedMemory == memory.id,
                        mouseDistance: distance(from: mouseLocation, to: memory.position)
                    )
                    .position(memory.position)
                    .onTapGesture {
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                            selectedMemory = selectedMemory == memory.id ? nil : memory.id
                        }
                    }
                }
                
                // Input overlay for selected memory
                if let selected = selectedMemory,
                   let memory = memories.first(where: { $0.id == selected }) {
                    VStack(spacing: 20) {
                        Spacer()
                        
                        VStack(spacing: 12) {
                            Text("Fragment of recall:")
                                .font(.system(size: 12, weight: .light, design: .default))
                                .foregroundColor(Color.white.opacity(0.6))
                            
                            GlitchingTextField(
                                text: Binding(
                                    get: { memoryInputs[selected] ?? "" },
                                    set: { memoryInputs[selected] = $0 }
                                ),
                                placeholder: "what remains..."
                            )
                            .frame(width: 300)
                        }
                        .padding(.bottom, 60)
                    }
                }
            }
            .onAppear {
                initializeMemories(in: geometry.size)
                startParticleAnimation(in: geometry.size)
                startHeartbeat()
                startMemoryDecay()
            }
            .onContinuousHover { phase in
                switch phase {
                case .active(let location):
                    let currentLocation = CGPoint(x: location.x, y: location.y)
                    let velocity = hypot(currentLocation.x - lastMouseLocation.x,
                                       currentLocation.y - lastMouseLocation.y)
                    
                    mouseLocation = currentLocation
                    shakeVelocity = velocity
                    lastMouseLocation = currentLocation
                    
                    if velocity > 15 {
                        restoreNearbyMemories()
                    }
                case .ended:
                    shakeVelocity = 0
                }
            }
        }
        .frame(width: 1440, height: 900)
        .background(Color.black)
    }
    
    func initializeMemories(in size: CGSize) {
        memories = memoryImages.enumerated().map { index, caption in
            let age = TimeInterval(index * 3 + Int.random(in: 1...5))
            let centerX = size.width / 2
            let centerY = size.height / 2
            let angle = Double(index) * .pi * 2 / Double(memoryImages.count) + Double.random(in: -0.3...0.3)
            let radius = 250 + Double.random(in: -50...50)
            
            return PolaroidMemory(
                imageData: generateImageData(),
                position: CGPoint(
                    x: centerX + cos(angle) * radius,
                    y: centerY + sin(angle) * radius
                ),
                rotation: Double.random(in: -0.3...0.3),
                scale: 1.0,
                pixelLoss: min(0.8, age * 0.05),
                saturation: max(0.2, 1.0 - age * 0.1),
                memoryAge: age,
                caption: caption,
                floatPhase: Double.random(in: 0...(.pi * 2))
            )
        }
    }
    
    func generateImageData() -> [[Double]] {
        var data: [[Double]] = []
        for _ in 0..<50 {
            var row: [Double] = []
            for _ in 0..<50 {
                row.append(Double.random(in: 0...1))
            }
            data.append(row)
        }
        return data
    }
    
    func startParticleAnimation(in size: CGSize) {
        particles = (0..<30).map { _ in
            MemoryParticle(
                position: CGPoint(
                    x: CGFloat.random(in: 0...size.width),
                    y: CGFloat.random(in: 0...size.height)
                ),
                opacity: Double.random(in: 0.1...0.3),
                size: CGFloat.random(in: 2...6)
            )
        }
        
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            withAnimation(.linear(duration: 0.05)) {
                for i in particles.indices {
                    particles[i].position.y -= 1
                    if particles[i].position.y < 0 {
                        particles[i].position.y = size.height
                        particles[i].position.x = CGFloat.random(in: 0...size.width)
                    }
                    particles[i].opacity = Double.random(in: 0.1...0.3)
                }
            }
        }
    }
    
    func startHeartbeat() {
        Timer.scheduledTimer(withTimeInterval: 0.8, repeats: true) { _ in
            withAnimation(.easeInOut(duration: 0.2)) {
                heartbeatScale = 1.1
                heartbeatOpacity = 0.25
            }
            
            withAnimation(.easeInOut(duration: 0.6).delay(0.2)) {
                heartbeatScale = 1.0
                heartbeatOpacity = 0.15
            }
        }
    }
    
    func startMemoryDecay() {
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            withAnimation(.linear(duration: 1.0)) {
                for i in memories.indices {
                    memories[i].memoryAge += 1
                    memories[i].pixelLoss = min(0.95, memories[i].memoryAge * 0.01)
                    memories[i].saturation = max(0.05, 1.0 - memories[i].memoryAge * 0.02)
                    
                    let phase = memories[i].floatPhase + 0.02
                    memories[i].floatPhase = phase
                    memories[i].position.y += sin(phase) * 0.5
                }
            }
        }
    }
    
    func restoreNearbyMemories() {
        withAnimation(.spring(response: 0.6, dampingFraction: 0.7)) {
            for i in memories.indices {
                let dist = distance(from: mouseLocation, to: memories[i].position)
                if dist < 150 {
                    memories[i].pixelLoss = max(0.2, memories[i].pixelLoss - 0.1)
                    memories[i].saturation = min(1.0, memories[i].saturation + 0.1)
                }
            }
        }
    }
    
    func distance(from: CGPoint, to: CGPoint) -> CGFloat {
        return hypot(from.x - to.x, from.y - to.y)
    }
}