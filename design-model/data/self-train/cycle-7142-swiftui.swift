struct ContentView: View {
    @State private var memories: [MemoryFragment] = [
        MemoryFragment(image: "photo", position: CGPoint(x: 720, y: 450), confidence: 0.9, lastTouched: Date()),
        MemoryFragment(image: "photo.fill", position: CGPoint(x: 500, y: 300), confidence: 0.7, lastTouched: Date().addingTimeInterval(-3600)),
        MemoryFragment(image: "camera.fill", position: CGPoint(x: 900, y: 350), confidence: 0.5, lastTouched: Date().addingTimeInterval(-7200)),
        MemoryFragment(image: "memories", position: CGPoint(x: 600, y: 600), confidence: 0.3, lastTouched: Date().addingTimeInterval(-10800))
    ]
    
    @State private var particles: [DissolveParticle] = []
    @State private var centerPull: Double = 0.0
    @State private var timeElapsed: Double = 0
    @State private var draggedMemory: UUID?
    
    let center = CGPoint(x: 720, y: 450)
    let maxRadius: Double = 400
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Dark void background
                RadialGradient(
                    colors: [
                        Color(red: 0.05, green: 0.05, blue: 0.08),
                        Color(red: 0.0, green: 0.0, blue: 0.0)
                    ],
                    center: .center,
                    startRadius: 0,
                    endRadius: 500
                )
                .ignoresSafeArea()
                
                // Whirlpool effect
                ForEach(0..<5) { ring in
                    Circle()
                        .stroke(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.2, green: 0.1, blue: 0.3).opacity(0.1 - Double(ring) * 0.02),
                                    Color(red: 0.1, green: 0.05, blue: 0.2).opacity(0.05 - Double(ring) * 0.01)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 2
                        )
                        .frame(width: CGFloat(200 + ring * 150), height: CGFloat(200 + ring * 150))
                        .rotationEffect(.degrees(timeElapsed * 30 / Double(ring + 1)))
                        .position(center)
                        .blur(radius: CGFloat(ring) * 0.5)
                }
                
                // Dissolving particles
                ForEach(particles) { particle in
                    Circle()
                        .fill(Color.white.opacity(particle.opacity))
                        .frame(width: particle.size, height: particle.size)
                        .position(particle.position)
                        .blur(radius: (1.0 - particle.opacity) * 3)
                }
                
                // Memory fragments
                ForEach(memories) { memory in
                    MemoryView(
                        memory: memory,
                        center: center,
                        isDragging: draggedMemory == memory.id
                    )
                    .position(memory.position)
                    .onDrag {
                        draggedMemory = memory.id
                        return NSItemProvider(object: memory.id.uuidString as NSString)
                    }
                    .onDrop(of: [.text], delegate: MemoryDropDelegate(
                        memories: $memories,
                        memoryId: memory.id,
                        center: center
                    ))
                }
                
                // Center reinforcement zone
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(red: 0.9, green: 0.85, blue: 0.7).opacity(0.3),
                                Color.clear
                            ],
                            center: .center,
                            startRadius: 0,
                            endRadius: 100
                        )
                    )
                    .frame(width: 200, height: 200)
                    .position(center)
                    .blur(radius: 10)
                
                // UI Controls
                VStack {
                    HStack {
                        Text("Memory Decay Calculator")
                            .font(.system(size: 24, weight: .light, design: .serif))
                            .foregroundColor(Color(red: 0.8, green: 0.75, blue: 0.6))
                        
                        Spacer()
                        
                        VStack(alignment: .trailing) {
                            Text("Entropy Force: \(String(format: "%.1f", centerPull * 100))%")
                                .font(.system(size: 14, weight: .regular, design: .monospaced))
                                .foregroundColor(Color(red: 0.6, green: 0.55, blue: 0.5))
                            
                            Text("Active Memories: \(memories.count)")
                                .font(.system(size: 14, weight: .regular, design: .monospaced))
                                .foregroundColor(Color(red: 0.6, green: 0.55, blue: 0.5))
                        }
                    }
                    .padding(30)
                    
                    Spacer()
                }
            }
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            startDecaySimulation()
        }
    }
    
    func startDecaySimulation() {
        Timer.scheduledTimer(withTimeInterval: 0.03, repeats: true) { timer in
            timeElapsed += 0.03
            centerPull = min(1.0, timeElapsed * 0.001)
            
            // Update memory positions based on decay
            for i in memories.indices {
                if draggedMemory != memories[i].id {
                    let timeSinceTouch = Date().timeIntervalSince(memories[i].lastTouched)
                    let decayFactor = 1.0 / (1.0 + timeSinceTouch * 0.0001)
                    
                    // Pull toward center based on decay
                    let dx = center.x - memories[i].position.x
                    let dy = center.y - memories[i].position.y
                    let distance = sqrt(dx * dx + dy * dy)
                    
                    if distance > 10 {
                        let pullStrength = centerPull * (1.0 - decayFactor) * 0.5
                        memories[i].position.x += dx / distance * pullStrength
                        memories[i].position.y += dy / distance * pullStrength
                    }
                    
                    // Decrease confidence over time
                    memories[i].confidence = max(0.1, memories[i].confidence - 0.0001)
                    
                    // Create dissolve particles for very weak memories
                    if memories[i].confidence < 0.3 && Int.random(in: 0...100) < 2 {
                        let particle = DissolveParticle(
                            position: memories[i].position,
                            size: CGFloat.random(in: 2...6),
                            opacity: memories[i].confidence
                        )
                        particles.append(particle)
                    }
                }
            }
            
            // Update particles
            particles = particles.compactMap { particle in
                var updated = particle
                updated.opacity -= 0.02
                updated.position.y -= 1
                updated.position.x += CGFloat.random(in: -1...1)
                return updated.opacity > 0 ? updated : nil
            }
            
            // Remove memories that are too weak
            memories = memories.filter { $0.confidence > 0.05 }
        }
    }
}