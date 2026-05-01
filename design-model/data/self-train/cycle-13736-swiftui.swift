struct ContentView: View {
    @State private var energyNodes: [EnergyNode] = []
    @State private var memoryLayers: [MemoryLayer] = []
    @State private var activityCrystals: [ActivityCrystal] = []
    @State private var hoveredNode: UUID?
    @State private var draggedNode: UUID?
    @State private var currentTime: Double = 12.0
    @State private var breathPhase: Double = 0
    @State private var rippleEffects: [RippleEffect] = []
    
    let center = CGPoint(x: 720, y: 450)
    let maxRadius: Double = 380
    
    var body: some View {
        ZStack {
            Color(red: 0.03, green: 0.02, blue: 0.05)
                .ignoresSafeArea()
            
            Canvas { context, size in
                // Memory layers
                for layer in memoryLayers {
                    drawMemoryLayer(layer, in: context)
                }
                
                // Current energy membrane
                drawEnergyMembrane(in: context)
                
                // Ripple effects
                for ripple in rippleEffects {
                    drawRipple(ripple, in: context)
                }
                
                // Time rings
                drawTimeRings(in: context)
            }
            .frame(width: 1440, height: 900)
            .gesture(
                DragGesture()
                    .onChanged { value in
                        handleDrag(at: value.location)
                    }
                    .onEnded { _ in
                        draggedNode = nil
                    }
            )
            
            // Activity crystals
            ForEach(activityCrystals) { crystal in
                CrystalView(crystal: crystal)
                    .position(crystal.position)
            }
            
            // UI overlay
            VStack {
                HStack {
                    Text("ENERGY TOPOLOGY")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(Color(red: 0.7, green: 0.8, blue: 0.9))
                        .opacity(0.6)
                    
                    Spacer()
                    
                    Text(timeLabel)
                        .font(.system(size: 14, weight: .light, design: .rounded))
                        .foregroundColor(Color(red: 0.9, green: 0.95, blue: 1.0))
                }
                .padding(.horizontal, 40)
                .padding(.top, 30)
                
                Spacer()
            }
        }
        .onAppear {
            initializeNodes()
            startBreathing()
            loadMemoryLayers()
        }
    }
    
    var timeLabel: String {
        let hour = Int(currentTime) % 24
        let minute = Int((currentTime - Double(hour)) * 60)
        return String(format: "%02d:%02d", hour, minute)
    }
    
    func initializeNodes() {
        for i in 0..<24 {
            let angle = (Double(i) / 24.0) * 2 * .pi - .pi / 2
            let baseRadius = maxRadius * 0.7
            let variation = Double.random(in: -0.2...0.2)
            let radius = baseRadius * (1 + variation)
            
            let x = center.x + cos(angle) * radius
            let y = center.y + sin(angle) * radius
            
            energyNodes.append(EnergyNode(
                time: Double(i),
                energy: 0.5 + Double.random(in: -0.1...0.1),
                position: CGPoint(x: x, y: y)
            ))
        }
        
        // Add activity crystals
        activityCrystals = [
            ActivityCrystal(name: "deep work", position: CGPoint(x: 400, y: 200)),
            ActivityCrystal(name: "exercise", position: CGPoint(x: 1000, y: 300)),
            ActivityCrystal(name: "meditation", position: CGPoint(x: 300, y: 600)),
            ActivityCrystal(name: "social", position: CGPoint(x: 1100, y: 700))
        ]
    }
    
    func loadMemoryLayers() {
        for i in 1...3 {
            var layerNodes: [EnergyNode] = []
            for j in 0..<24 {
                let angle = (Double(j) / 24.0) * 2 * .pi - .pi / 2
                let baseRadius = maxRadius * (0.7 - Double(i) * 0.05)
                let variation = Double.random(in: -0.3...0.3)
                let radius = baseRadius * (1 + variation)
                
                let x = center.x + cos(angle) * radius
                let y = center.y + sin(angle) * radius
                
                layerNodes.append(EnergyNode(
                    time: Double(j),
                    energy: 0.5 + Double.random(in: -0.3...0.3),
                    position: CGPoint(x: x, y: y)
                ))
            }
            
            memoryLayers.append(MemoryLayer(
                nodes: layerNodes,
                opacity: 0.15 / Double(i),
                date: Date().addingTimeInterval(-Double(i * 7 * 24 * 60 * 60))
            ))
        }
    }
    
    func startBreathing() {
        Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { _ in
            breathPhase += 0.02
            
            // Update ripples
            rippleEffects = rippleEffects.compactMap { ripple in
                var updated = ripple
                updated.radius += 3
                updated.opacity -= 0.015
                return updated.opacity > 0 ? updated : nil
            }
            
            // Physics update for nodes
            for i in energyNodes.indices {
                if !energyNodes[i].isAnchored {
                    // Spring force to ideal position
                    let angle = (energyNodes[i].time / 24.0) * 2 * .pi - .pi / 2
                    let idealRadius = maxRadius * 0.7 * (1 + energyNodes[i].energy * 0.3)
                    let idealX = center.x + cos(angle) * idealRadius
                    let idealY = center.y + sin(angle) * idealRadius
                    
                    let dx = idealX - energyNodes[i].position.x
                    let dy = idealY - energyNodes[i].position.y
                    
                    energyNodes[i].position.x += dx * 0.05
                    energyNodes[i].position.y += dy * 0.05
                }
            }
        }
    }
    
    func handleDrag(at location: CGPoint) {
        for i in energyNodes.indices {
            let distance = sqrt(pow(location.x - energyNodes[i].position.x, 2) + pow(location.y - energyNodes[i].position.y, 2))
            if distance < 30 {
                draggedNode = energyNodes[i].id
                energyNodes[i].position = location
                energyNodes[i].isAnchored = true
                
                // Create ripple
                rippleEffects.append(RippleEffect(
                    center: location,
                    radius: 0,
                    opacity: 0.5
                ))
                
                // Update energy based on distance from center
                let distanceFromCenter = sqrt(pow(location.x - center.x, 2) + pow(location.y - center.y, 2))
                energyNodes[i].energy = min(1.0, max(0.0, distanceFromCenter / maxRadius))
                return
            }
        }
    }
    
    func drawMemoryLayer(_ layer: MemoryLayer, in context: GraphicsContext) {
        var path = Path()
        
        for (index, node) in layer.nodes.enumerated() {
            if index == 0 {
                path.move(to: node.position)
            } else {
                path.addLine(to: node.position)
            }
        }
        
        if let firstNode = layer.nodes.first {
            path.addLine(to: firstNode.position)
        }
        
        context.stroke(path, with: .color(Color(red: 0.4, green: 0.6, blue: 0.8).opacity(layer.opacity)), lineWidth: 1)
    }
    
    func drawEnergyMembrane(in context: GraphicsContext) {
        var path = Path()
        
        for (index, node) in energyNodes.enumerated() {
            let breathOffset = sin(breathPhase + Double(index) * 0.3) * 5
            let point = CGPoint(
                x: node.position.x + cos(breathPhase) * breathOffset,
                y: node.position.y + sin(breathPhase) * breathOffset
            )
            
            if index == 0 {
                path.move(to: point)
            } else {
                let prevNode = energyNodes[index - 1]
                let controlPoint1 = CGPoint(
                    x: (prevNode.position.x + point.x) / 2,
                    y: prevNode.position.y
                )
                let controlPoint2 = CGPoint(
                    x: (prevNode.position.x + point.x) / 2,
                    y: point.y
                )
                path.addCurve(to: point, control1: controlPoint1, control2: controlPoint2)
            }
        }
        
        if let firstNode = energyNodes.first, let lastNode = energyNodes.last {
            let controlPoint1 = CGPoint(
                x: (lastNode.position.x + firstNode.position.x) / 2,
                y: lastNode.position.y
            )
            let controlPoint2 = CGPoint(
                x: (lastNode.position.x + firstNode.position.x) / 2,
                y: firstNode.position.y
            )
            path.addCurve(to: CGPoint(
                x: firstNode.position.x + cos(breathPhase) * sin(breathPhase) * 5,
                y: firstNode.position.y + sin(breathPhase) * sin(breathPhase) * 5
            ), control1: controlPoint1, control2: controlPoint2)
        }
        
        let gradient = Gradient(colors: [
            Color(red: 0.3, green: 0.5, blue: 0.9).opacity(0.3),
            Color(red: 0.5, green: 0.7, blue: 1.0).opacity(0.1)
        ])
        
        context.fill(path, with: .linearGradient(gradient, startPoint: CGPoint(x: center.x, y: center.y - maxRadius), endPoint: CGPoint(x: center.x, y: center.y + maxRadius)))
        context.stroke(path, with: .color(Color(red: 0.6, green: 0.8, blue: 1.0).opacity(0.8)), lineWidth: 2)
        
        // Draw nodes
        for node in energyNodes {
            let nodeColor = Color(
                red: 0.5 + node.energy * 0.5,
                green: 0.7 + node.energy * 0.3,
                blue: 0.9
            )
            
            context.fill(
                Circle().path(in: CGRect(x: node.position.x - 6, y: node.position.y - 6, width: 12, height: 12)),
                with: .color(nodeColor)
            )
            
            if node.id == hoveredNode {
                context.stroke(
                    Circle().path(in: CGRect(x: node.position.x - 10, y: node.position.y - 10, width: 20, height: 20)),
                    with: .color(nodeColor.opacity(0.5)),
                    lineWidth: 2
                )
            }
        }
    }
    
    func drawRipple(_ ripple: RippleEffect, in context: GraphicsContext) {
        context.stroke(
            Circle().path(in: CGRect(x: ripple.center.x - ripple.radius, y: ripple.center.y - ripple.radius, width: ripple.radius * 2, height: ripple.radius * 2)),
            with: .color(Color(red: 0.7, green: 0.8, blue: 1.0).opacity(ripple.opacity)),
            lineWidth: 2
        )
    }
    
    func drawTimeRings(in context: GraphicsContext) {
        for i in 0..<3 {
            let radius = maxRadius * (0.4 + Double(i) * 0.3)
            context.stroke(
                Circle().path(in: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)),
                with: .color(Color.white.opacity(0.05)),
                lineWidth: 1
            )
        }
        
        // Time markers
        for i in 0..<24 {
            if i % 6 == 0 {
                let angle = (Double(i) / 24.0) * 2 * .pi - .pi / 2
                let innerRadius = maxRadius * 0.85
                let outerRadius = maxRadius * 0.95
                
                let innerPoint = CGPoint(
                    x: center.x + cos(angle) * innerRadius,
                    y: center.y + sin(angle) * innerRadius
                )
                let outerPoint = CGPoint(
                    x: center.x + cos(angle) * outerRadius,
                    y: center.y + sin(angle) * outerRadius
                )
                
                context.stroke(
                    Path { path in
                        path.move(to: innerPoint)
                        path.addLine(to: outerPoint)
                    },
                    with: .color(Color.white.opacity(0.2)),
                    lineWidth: 2
                )
            }
        }
    }
}