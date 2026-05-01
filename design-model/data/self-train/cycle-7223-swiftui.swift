struct ContentView: View {
    @State private var thoughts: [ThoughtBubble] = []
    @State private var vessels: [CrystallineVessel] = [
        CrystallineVessel(position: CGPoint(x: 240, y: 750)),
        CrystallineVessel(position: CGPoint(x: 480, y: 750)),
        CrystallineVessel(position: CGPoint(x: 720, y: 750)),
        CrystallineVessel(position: CGPoint(x: 960, y: 750)),
        CrystallineVessel(position: CGPoint(x: 1200, y: 750))
    ]
    @State private var particles: [AmbientParticle] = []
    @State private var breathPhase: Double = 0
    @State private var currentDrag: DragGesture.Value?
    @State private var draggedThought: UUID?
    @State private var twilightPhase: Double = 0
    @State private var captureGlow: [UUID: Double] = [:]
    
    let dreamWords = [
        "whisper", "dissolve", "float", "remember", "echo", "shimmer",
        "drift", "glow", "fade", "linger", "emerge", "vanish", "bloom",
        "flicker", "trace", "wander", "ripple", "gleam", "shadow", "melt"
    ]
    
    let thoughtTimer = Timer.publish(every: 2.3, on: .main, in: .common).autoconnect()
    let particleTimer = Timer.publish(every: 0.8, on: .main, in: .common).autoconnect()
    let animationTimer = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            twilightGradient
            
            ForEach(particles) { particle in
                Circle()
                    .fill(Color.white.opacity(particle.opacity * 0.3))
                    .frame(width: particle.size, height: particle.size)
                    .position(particle.position)
                    .blur(radius: 2)
            }
            
            ForEach($thoughts) { $thought in
                if !thought.isCaptured {
                    thoughtBubbleView(thought: $thought)
                }
            }
            
            ForEach($vessels) { $vessel in
                vesselView(vessel: $vessel)
            }
            
            breathingIndicator
        }
        .frame(width: 1440, height: 900)
        .onReceive(thoughtTimer) { _ in
            spawnThought()
        }
        .onReceive(particleTimer) { _ in
            spawnParticle()
        }
        .onReceive(animationTimer) { _ in
            updateAnimations()
        }
    }
    
    var twilightGradient: some View {
        LinearGradient(
            stops: [
                .init(color: Color(red: 0.11 + twilightPhase * 0.05, 
                                 green: 0.09 + twilightPhase * 0.03, 
                                 blue: 0.24 + twilightPhase * 0.1), location: 0),
                .init(color: Color(red: 0.18 + twilightPhase * 0.1, 
                                 green: 0.15 + twilightPhase * 0.08, 
                                 blue: 0.35 + twilightPhase * 0.15), location: 0.3),
                .init(color: Color(red: 0.4 + twilightPhase * 0.2, 
                                 green: 0.25 + twilightPhase * 0.15, 
                                 blue: 0.45 + twilightPhase * 0.1), location: 0.6),
                .init(color: Color(red: 0.65 + twilightPhase * 0.25, 
                                 green: 0.4 + twilightPhase * 0.2, 
                                 blue: 0.5 + twilightPhase * 0.15), location: 1)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
    }
    
    func thoughtBubbleView(thought: Binding<ThoughtBubble>) -> some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color.white.opacity(0.1 * thought.wrappedValue.opacity),
                            Color.white.opacity(0.05 * thought.wrappedValue.opacity),
                            Color.clear
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: 60
                    )
                )
                .frame(width: 120 * thought.wrappedValue.scale, 
                       height: 120 * thought.wrappedValue.scale)
                .blur(radius: 3)
            
            Text(thought.wrappedValue.content)
                .font(.system(size: 18, weight: .light, design: .serif))
                .foregroundColor(Color.white.opacity(0.7 * thought.wrappedValue.opacity))
                .shadow(color: Color(red: 0.8, green: 0.7, blue: 0.9).opacity(0.5), 
                       radius: 8, x: 0, y: 0)
        }
        .scaleEffect(thought.wrappedValue.scale)
        .position(thought.wrappedValue.position)
        .opacity(thought.wrappedValue.opacity)
        .onDrag {
            draggedThought = thought.wrappedValue.id
            return NSItemProvider(object: thought.wrappedValue.id.uuidString as NSString)
        } preview: {
            EmptyView()
        }
        .onDrop(of: [.text], delegate: ThoughtDropDelegate(
            thoughtID: thought.wrappedValue.id,
            thoughts: $thoughts,
            vessels: $vessels,
            captureGlow: $captureGlow
        ))
    }
    
    func vesselView(vessel: Binding<CrystallineVessel>) -> some View {
        ZStack {
            ForEach(Array(vessel.wrappedValue.capturedThoughts.enumerated()), id: \.element.id) { index, thought in
                Text(thought.content)
                    .font(.system(size: 12, weight: .ultraLight, design: .serif))
                    .foregroundColor(Color.white.opacity(0.4))
                    .offset(y: CGFloat(-20 - index * 15))
                    .scaleEffect(0.8)
            }
            
            Path { path in
                let center = CGPoint(x: 40, y: 40)
                path.move(to: CGPoint(x: center.x, y: center.y - 35))
                path.addLine(to: CGPoint(x: center.x + 30, y: center.y + 20))
                path.addLine(to: CGPoint(x: center.x - 30, y: center.y + 20))
                path.closeSubpath()
            }
            .stroke(
                LinearGradient(
                    colors: [
                        Color(red: 0.8, green: 0.7, blue: 0.9).opacity(0.6),
                        Color(red: 0.6, green: 0.5, blue: 0.8).opacity(0.4)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                ),
                lineWidth: 2
            )
            .frame(width: 80, height: 80)
            .shadow(color: Color(red: 0.7, green: 0.6, blue: 0.9).opacity(captureGlow[vessel.id] ?? 0), 
                   radius: 20, x: 0, y: 0)
        }
        .position(vessel.position)
    }
    
    var breathingIndicator: some View {
        Circle()
            .stroke(
                Color.white.opacity(0.2),
                lineWidth: 1
            )
            .frame(width: 60 + sin(breathPhase) * 10, 
                   height: 60 + sin(breathPhase) * 10)
            .position(x: 720, y: 450)
            .blur(radius: 1)
    }
    
    func spawnThought() {
        let word = dreamWords.randomElement() ?? "dream"
        let startX = CGFloat.random(in: 100...1340)
        let thought = ThoughtBubble(
            content: word,
            position: CGPoint(x: startX, y: 100),
            opacity: 0.0,
            scale: 0.5
        )
        thoughts.append(thought)
    }
    
    func spawnParticle() {
        let particle = AmbientParticle(
            position: CGPoint(
                x: CGFloat.random(in: 0...1440),
                y: CGFloat.random(in: 0...900)
            ),
            opacity: 0.0,
            size: CGFloat.random(in: 2...6)
        )
        particles.append(particle)
    }
    
    func updateAnimations() {
        breathPhase += 0.05
        twilightPhase = (sin(breathPhase * 0.3) + 1) / 2
        
        for i in thoughts.indices where !thoughts[i].isCaptured {
            thoughts[i].position.y += 0.5
            thoughts[i].position.x += sin(breathPhase + Double(i)) * 0.3
            
            if thoughts[i].opacity < 1.0 {
                thoughts[i].opacity = min(1.0, thoughts[i].opacity + 0.02)
                thoughts[i].scale = min(1.0, thoughts[i].scale + 0.01)
            }
            
            if thoughts[i].position.y > 850 {
                thoughts[i].opacity = max(0, thoughts[i].opacity - 0.02)
            }
        }
        
        for i in particles.indices {
            particles[i].position.y -= 0.3
            particles[i].position.x += sin(breathPhase + Double(i) * 0.5) * 0.2
            
            if particles[i].opacity < 0.6 {
                particles[i].opacity = min(0.6, particles[i].opacity + 0.01)
            }
            
            if particles[i].position.y < 0 {
                particles[i].opacity = max(0, particles[i].opacity - 0.01)
            }
        }
        
        thoughts.removeAll { $0.opacity <= 0 && !$0.isCaptured }
        particles.removeAll { $0.opacity <= 0 }
        
        for id in captureGlow.keys {
            if let currentGlow = captureGlow[id], currentGlow > 0 {
                captureGlow[id] = max(0, currentGlow - 0.02)
            }
        }
    }
}