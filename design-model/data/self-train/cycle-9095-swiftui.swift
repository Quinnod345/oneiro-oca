struct ContentView: View {
    @State private var memories: [MemoryOrb] = []
    @State private var particles: [LuminousParticle] = []
    @State private var hoveredMemory: UUID?
    @State private var activeExamination: UUID?
    @State private var examinationDuration: TimeInterval = 0
    @State private var vaultPosition: CGPoint = CGPoint(x: 720, y: 450)
    @State private var preservedMemories: [MemoryOrb] = []
    @State private var connections: [ConstellationConnection] = []
    @State private var bidBalance: CGFloat = 100.0
    @State private var currentBid: CGFloat = 0
    @State private var draggedMemory: UUID?
    @State private var mouseLocation: CGPoint = .zero
    
    let memoryScenes = [
        "First day of school, nervous hands clutching a new backpack",
        "Grandmother's kitchen, flour dust dancing in afternoon light",
        "That summer road trip, windows down, singing off-key",
        "The argument that changed everything, words like broken glass",
        "Dancing in the rain after graduation, mascara running",
        "Last conversation with dad, hospital machines beeping",
        "Wedding day nerves, hands trembling with the rings",
        "Child's first steps, arms outstretched for balance"
    ]
    
    let updateTimer = Timer.publish(every: 0.016, on: .main, in: .common).autoconnect()
    let damageTimer = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            // Dark auction house atmosphere
            RadialGradient(
                colors: [
                    Color(red: 0.05, green: 0.05, blue: 0.08),
                    Color(red: 0.02, green: 0.02, blue: 0.04),
                    Color.black
                ],
                center: .center,
                startRadius: 200,
                endRadius: 900
            )
            .ignoresSafeArea()
            
            // Floating particles
            ForEach(particles) { particle in
                Circle()
                    .fill(Color(hue: particle.hue, saturation: 0.8, brightness: 0.9))
                    .frame(width: 4, height: 4)
                    .blur(radius: 1)
                    .opacity(particle.opacity)
                    .position(particle.position)
            }
            
            // Memory orbs
            ForEach(memories) { memory in
                MemoryOrbView(
                    memory: memory,
                    isHovered: hoveredMemory == memory.id,
                    isActive: activeExamination == memory.id,
                    mouseLocation: mouseLocation
                )
                .position(memory.position)
                .onHover { hovering in
                    if hovering {
                        hoveredMemory = memory.id
                    } else if hoveredMemory == memory.id {
                        hoveredMemory = nil
                    }
                }
                .onTapGesture {
                    if activeExamination == memory.id {
                        activeExamination = nil
                        examinationDuration = 0
                    } else {
                        activeExamination = memory.id
                        examinationDuration = 0
                    }
                }
                .offset(x: draggedMemory == memory.id ? mouseLocation.x - memory.position.x : 0,
                       y: draggedMemory == memory.id ? mouseLocation.y - memory.position.y : 0)
            }
            
            // Central vault
            VaultView(position: vaultPosition, preservedCount: preservedMemories.count)
            
            // Constellation map overlay
            if !preservedMemories.isEmpty {
                ConstellationMapView(memories: preservedMemories, connections: connections)
                    .allowsHitTesting(false)
            }
            
            // Auction interface
            VStack {
                HStack {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("MEMORY FRAGMENTS")
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundColor(Color(red: 0.6, green: 0.6, blue: 0.7))
                            .tracking(2)
                        
                        Text("\(Int(bidBalance))")
                            .font(.system(size: 42, weight: .thin, design: .default))
                            .foregroundColor(.white)
                    }
                    
                    Spacer()
                    
                    if activeExamination != nil {
                        VStack(alignment: .trailing, spacing: 4) {
                            Text("EXAMINING")
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .foregroundColor(Color(red: 0.9, green: 0.3, blue: 0.3))
                            
                            Text(String(format: "%.1fs", examinationDuration))
                                .font(.system(size: 18, weight: .light, design: .monospaced))
                                .foregroundColor(Color(red: 0.9, green: 0.5, blue: 0.5))
                        }
                    }
                }
                .padding(40)
                
                Spacer()
                
                HStack(spacing: 40) {
                    Text("PRESERVED: \(preservedMemories.count)")
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundColor(Color(red: 0.4, green: 0.8, blue: 0.9))
                    
                    Text("AT RISK: \(memories.filter { $0.cracks > 0 }.count)")
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundColor(Color(red: 0.9, green: 0.6, blue: 0.4))
                }
                .padding(40)
            }
        }
        .onAppear {
            setupMemories()
            setupParticles()
        }
        .onReceive(updateTimer) { _ in
            updateParticles()
            updateMemoryPositions()
            if activeExamination != nil {
                examinationDuration += 0.016
            }
        }
        .onReceive(damageTimer) { _ in
            damageMemories()
        }
    }
    
    func setupMemories() -> Void {
        for i in 0..<8 {
            let angle = Double(i) * .pi * 2 / 8
            let radius: CGFloat = 250
            let centerX: CGFloat = 720
            let centerY: CGFloat = 450
            
            let memory = MemoryOrb(
                position: CGPoint(
                    x: centerX + cos(angle) * radius,
                    y: centerY + sin(angle) * radius
                ),
                velocity: CGVector(dx: 0, dy: 0),
                content: memoryScenes[i],
                luminosity: CGFloat.random(in: 0.7...1.0),
                hue: CGFloat.random(in: 0.0...1.0)
            )
            memories.append(memory)
        }
    }
    
    func setupParticles() -> Void {
        for _ in 0..<50 {
            let particle = LuminousParticle(
                position: CGPoint(
                    x: CGFloat.random(in: 0...1440),
                    y: CGFloat.random(in: 0...900)
                ),
                velocity: CGVector(
                    dx: CGFloat.random(in: -1...1),
                    dy: CGFloat.random(in: -0.5...0.5)
                ),
                opacity: CGFloat.random(in: 0.3...0.7),
                hue: CGFloat.random(in: 0.0...1.0)
            )
            particles.append(particle)
        }
    }
    
    func updateParticles() -> Void {
        for i in particles.indices {
            particles[i].position.x += particles[i].velocity.dx
            particles[i].position.y += particles[i].velocity.dy
            
            if particles[i].position.x < -10 {
                particles[i].position.x = 1450
            } else if particles[i].position.x > 1450 {
                particles[i].position.x = -10
            }
            
            particles[i].opacity = particles[i].opacity * 0.995
            if particles[i].opacity < 0.1 {
                particles[i].opacity = CGFloat.random(in: 0.5...0.7)
                particles[i].position = CGPoint(
                    x: CGFloat.random(in: 0...1440),
                    y: CGFloat.random(in: 0...900)
                )
            }
        }
    }
    
    func updateMemoryPositions() -> Void {
        let centerX: CGFloat = 720
        let centerY: CGFloat = 450
        
        for i in memories.indices {
            let angle = Double(i) * .pi * 2 / Double(memories.count) + Date().timeIntervalSince1970 * 0.1
            let radius: CGFloat = 250 + sin(Date().timeIntervalSince1970 * 0.5 + Double(i)) * 20
            
            let targetX = centerX + cos(angle) * radius
            let targetY = centerY + sin(angle) * radius
            
            memories[i].position.x += (targetX - memories[i].position.x) * 0.05
            memories[i].position.y += (targetY - memories[i].position.y) * 0.05
            
            memories[i].luminosity = 0.7 + sin(Date().timeIntervalSince1970 * 2 + Double(i)) * 0.3
        }
    }
    
    func damageMemories() -> Void {
        for i in memories.indices {
            if activeExamination != memories[i].id && CGFloat.random(in: 0...1) < 0.02 {
                memories[i].cracks = min(memories[i].cracks + 1, 5)
                if memories[i].cracks >= 5 {
                    memories[i].luminosity *= 0.9
                }
            }
        }
    }
}