struct ContentView: View {
    @State private var stars: [Star] = []
    @State private var connections: [Connection] = []
    @State private var viewerPosition: CGPoint = CGPoint(x: 720, y: 450)
    @State private var viewerDepth: Double = 0.5
    @State private var selectedStar: UUID?
    @State private var hoveredStar: UUID?
    @State private var navigationVelocity: CGSize = .zero
    @State private var depthVelocity: Double = 0
    @State private var auroraPhase: Double = 0
    @State private var twinklePhases: [UUID: Double] = [:]
    
    let timer = Timer.publish(every: 0.016, on: .main, in: .common).autoconnect()
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Deep space background
                LinearGradient(
                    colors: [
                        Color(red: 0.02, green: 0.02, blue: 0.08),
                        Color(red: 0.0, green: 0.0, blue: 0.02)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()
                
                // Nebula clouds
                ForEach(0..<3) { i in
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    Color(red: 0.1, green: 0.05, blue: 0.2).opacity(0.1),
                                    Color.clear
                                ],
                                center: .center,
                                startRadius: 50,
                                endRadius: 300
                            )
                        )
                        .frame(width: 600, height: 600)
                        .offset(
                            x: sin(auroraPhase + Double(i) * 2.0) * 100,
                            y: cos(auroraPhase * 0.7 + Double(i) * 1.5) * 80
                        )
                        .blur(radius: 40)
                }
                
                // Star connections
                Canvas { context, size in
                    for connection in connections {
                        if let fromStar = stars.first(where: { $0.id == connection.from }),
                           let toStar = stars.first(where: { $0.id == connection.to }) {
                            
                            let fromPoint = projectPoint(fromStar.position, depth: fromStar.depth, viewSize: size)
                            let toPoint = projectPoint(toStar.position, depth: toStar.depth, viewSize: size)
                            
                            var path = Path()
                            path.move(to: fromPoint)
                            
                            let controlPoint1 = CGPoint(
                                x: fromPoint.x + (toPoint.x - fromPoint.x) * 0.3,
                                y: fromPoint.y + sin(connection.pulsePhase) * 20
                            )
                            let controlPoint2 = CGPoint(
                                x: fromPoint.x + (toPoint.x - fromPoint.x) * 0.7,
                                y: toPoint.y + cos(connection.pulsePhase) * 20
                            )
                            
                            path.addCurve(to: toPoint, control1: controlPoint1, control2: controlPoint2)
                            
                            let opacity = 0.3 + sin(connection.pulsePhase) * 0.2
                            let color = Color(red: 0.6, green: 0.7, blue: 1.0).opacity(opacity * connection.strength)
                            
                            context.stroke(path, with: .color(color), lineWidth: 1 + connection.strength)
                        }
                    }
                }
                .ignoresSafeArea()
                
                // Stars
                ForEach(stars) { star in
                    let projected = projectPoint(star.position, depth: star.depth, viewSize: geometry.size)
                    let scale = 1.0 / (1.0 + abs(star.depth - viewerDepth) * 2)
                    let twinkle = twinklePhases[star.id] ?? 0
                    
                    ZStack {
                        // Star glow
                        Circle()
                            .fill(
                                RadialGradient(
                                    colors: [
                                        star.memory.category.baseColor.opacity(star.brightness * 0.8),
                                        star.memory.category.baseColor.opacity(star.brightness * 0.3),
                                        Color.clear
                                    ],
                                    center: .center,
                                    startRadius: 0,
                                    endRadius: 30 * scale
                                )
                            )
                            .frame(width: 60 * scale, height: 60 * scale)
                            .blur(radius: 2)
                        
                        // Star core
                        Circle()
                            .fill(star.memory.category.baseColor)
                            .frame(width: 8 * scale * (1 + sin(twinkle) * 0.2), 
                                   height: 8 * scale * (1 + sin(twinkle) * 0.2))
                            .overlay(
                                Circle()
                                    .fill(Color.white.opacity(0.8))
                                    .frame(width: 3 * scale, height: 3 * scale)
                            )
                        
                        // Aurora ribbon for selected star
                        if star.id == selectedStar {
                            AuroraRibbon(
                                memory: star.memory,
                                phase: auroraPhase,
                                scale: scale
                            )
                        }
                    }
                    .position(projected)
                    .onTapGesture {
                        withAnimation(.spring()) {
                            selectedStar = star.id == selectedStar ? nil : star.id
                        }
                    }
                    .onHover { hovering in
                        hoveredStar = hovering ? star.id : nil
                    }
                }
                
                // Navigation controls
                VStack {
                    Spacer()
                    HStack {
                        VStack {
                            Button("↑") { navigationVelocity.height = -5 }
                                .buttonStyle(.plain)
                                .font(.system(size: 24))
                            HStack {
                                Button("←") { navigationVelocity.width = -5 }
                                    .buttonStyle(.plain)
                                    .font(.system(size: 24))
                                Button("→") { navigationVelocity.width = 5 }
                                    .buttonStyle(.plain)
                                    .font(.system(size: 24))
                            }
                            Button("↓") { navigationVelocity.height = 5 }
                                .buttonStyle(.plain)
                                .font(.system(size: 24))
                        }
                        .foregroundColor(.white.opacity(0.6))
                        
                        Spacer()
                        
                        VStack {
                            Button("Near") { depthVelocity = -0.01 }
                                .buttonStyle(.plain)
                            Button("Far") { depthVelocity = 0.01 }
                                .buttonStyle(.plain)
                        }
                        .foregroundColor(.white.opacity(0.6))
                    }
                    .padding()
                }
            }
        }
        .onAppear {
            generateStarfield()
        }
        .onReceive(timer) { _ in
            updateAnimation()
        }
    }
    
    func projectPoint(_ point: CGPoint, depth: Double, viewSize: CGSize) -> CGPoint {
        let depthDiff = depth - viewerDepth
        let parallaxFactor = 1.0 + depthDiff * 0.5
        
        let x = (point.x - viewerPosition.x) * parallaxFactor + viewSize.width / 2
        let y = (point.y - viewerPosition.y) * parallaxFactor + viewSize.height / 2
        
        return CGPoint(x: x, y: y)
    }
    
    func generateStarfield() {
        let categories = [MemoryCategory.joy, MemoryCategory.love, MemoryCategory.adventure, MemoryCategory.peace]
        
        for _ in 0..<50 {
            let memory = Memory(
                title: "Memory",
                category: categories.randomElement()!,
                intensity: Double.random(in: 0.5...1.0)
            )
            
            let star = Star(
                position: CGPoint(
                    x: Double.random(in: -500...1900),
                    y: Double.random(in: -500...1400)
                ),
                depth: Double.random(in: 0...1),
                brightness: Double.random(in: 0.3...1.0),
                memory: memory
            )
            
            stars.append(star)
            twinklePhases[star.id] = Double.random(in: 0...Double.pi * 2)
        }
        
        // Create some connections
        for _ in 0..<20 {
            if let from = stars.randomElement(), let to = stars.randomElement(), from.id != to.id {
                connections.append(
                    Connection(
                        from: from.id,
                        to: to.id,
                        strength: Double.random(in: 0.3...1.0),
                        pulsePhase: Double.random(in: 0...Double.pi * 2)
                    )
                )
            }
        }
    }
    
    func updateAnimation() {
        auroraPhase += 0.01
        
        viewerPosition.x += navigationVelocity.width
        viewerPosition.y += navigationVelocity.height
        viewerDepth = max(0, min(1, viewerDepth + depthVelocity))
        
        navigationVelocity.width *= 0.95
        navigationVelocity.height *= 0.95
        depthVelocity *= 0.95
        
        for (id, _) in twinklePhases {
            twinklePhases[id]? += Double.random(in: 0.05...0.1)
        }
        
        for i in 0..<connections.count {
            connections[i].pulsePhase += 0.05
        }
    }
}