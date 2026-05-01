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
    let timer = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Minimal gradient background
                Rectangle()
                    .fill(Color(white: 0.02))
                    .ignoresSafeArea()
                
                // Single subtle vortex
                ForEach(memories) { memory in
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    Color.white.opacity(0.02 * memory.confidence),
                                    Color.clear
                                ],
                                center: .center,
                                startRadius: 0,
                                endRadius: 150
                            )
                        )
                        .frame(width: 300, height: 300)
                        .position(center)
                        .scaleEffect(1.0 + sin(timeElapsed * 0.5) * 0.1)
                        .opacity(0.3)
                }
                
                // Particles only from decaying memories
                ForEach(particles) { particle in
                    Circle()
                        .fill(Color.white.opacity(particle.opacity * 0.6))
                        .frame(width: particle.size, height: particle.size)
                        .position(particle.position)
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
                }
                
                // Minimal UI
                VStack {
                    HStack {
                        Text("Memory Decay")
                            .font(.system(size: 18, weight: .light))
                            .foregroundColor(.white.opacity(0.4))
                        Spacer()
                        Text("\(String(format: "%.0f", centerPull * 100))%")
                            .font(.system(size: 14, weight: .light))
                            .foregroundColor(.white.opacity(0.3))
                    }
                    .padding(.horizontal, 30)
                    .padding(.top, 20)
                    
                    Spacer()
                }
            }
        }
        .onReceive(timer) { _ in
            timeElapsed += 0.05
            updateMemories()
            updateParticles()
            calculateCenterPull()
        }
    }
    
    private func updateMemories() {
        memories = memories.compactMap { memory in
            var updatedMemory = memory
            let timeSinceTouch = Date().timeIntervalSince(memory.lastTouched)
            let decayRate = 0.0005 * (1.0 + centerPull * 2.0)
            
            updatedMemory.confidence = max(0, memory.confidence - decayRate * timeSinceTouch / 60.0)
            
            if updatedMemory.confidence <= 0 {
                createParticlesForMemory(at: memory.position)
                return nil
            }
            
            // Subtle center pull
            let distanceToCenter = distance(from: memory.position, to: center)
            if distanceToCenter > 50 {
                let pullStrength = (1.0 - memory.confidence) * 0.3 * centerPull
                let angle = atan2(center.y - memory.position.y, center.x - memory.position.x)
                updatedMemory.position.x += cos(angle) * pullStrength
                updatedMemory.position.y += sin(angle) * pullStrength
            }
            
            return updatedMemory
        }
    }
    
    private func createParticlesForMemory(at position: CGPoint) {
        for _ in 0..<8 {
            let angle = Double.random(in: 0...(2 * .pi))
            let velocity = Double.random(in: 0.5...2.0)
            let directionToCenter = atan2(center.y - position.y, center.x - position.x)
            let finalAngle = angle * 0.3 + directionToCenter * 0.7
            
            let particle = DissolveParticle(
                position: position,
                velocity: CGPoint(
                    x: cos(finalAngle) * velocity,
                    y: sin(finalAngle) * velocity
                ),
                size: Double.random(in: 2...4),
                opacity: 0.8
            )
            particles.append(particle)
        }
    }
    
    private func updateParticles() {
        particles = particles.compactMap { particle in
            var updated = particle
            updated.position.x += particle.velocity.x
            updated.position.y += particle.velocity.y
            updated.opacity -= 0.02
            updated.size *= 0.98
            
            return updated.opacity > 0 ? updated : nil
        }
    }
    
    private func calculateCenterPull() {
        let totalDistance = memories.reduce(0.0) { sum, memory in
            sum + distance(from: memory.position, to: center)
        }
        let avgDistance = memories.isEmpty ? 0 : totalDistance / Double(memories.count)
        centerPull = min(1.0, avgDistance / 300.0)
    }
    
    private func distance(from: CGPoint, to: CGPoint) -> Double {
        sqrt(pow(from.x - to.x, 2) + pow(from.y - to.y, 2))
    }
}

struct MemoryView: View {
    let memory: MemoryFragment
    let center: CGPoint
    let isDragging: Bool
    
    var body: some View {
        ZStack {
            Image(systemName: memory.image)
                .font(.system(size: 40))
                .foregroundColor(.white.opacity(memory.confidence * 0.8))
                .blur(radius: (1.0 - memory.confidence) * 2)
                .scaleEffect(isDragging ? 1.1 : 1.0)
                .animation(.easeInOut(duration: 0.2), value: isDragging)
            
            Circle()
                .stroke(Color.white.opacity(memory.confidence * 0.2), lineWidth: 1)
                .frame(width: 60, height: 60)
                .blur(radius: 1)
        }
    }
}

struct MemoryFragment: Identifiable {
    let id = UUID()
    let image: String
    var position: CGPoint
    var confidence: Double
    let lastTouched: Date
}

struct DissolveParticle: Identifiable {
    let id = UUID()
    var position: CGPoint
    let velocity: CGPoint
    var size: Double
    var opacity: Double
}