struct ContentView: View {
    @State private var memoryBubbles: [MemoryBubble] = []
    @State private var dreamConstellation: DreamConstellation? = nil
    @State private var isDragging: UUID? = nil
    @State private var dragOffset: CGSize = .zero
    @State private var mistOffset: CGFloat = 0
    @State private var pulseTimer: Double = 0
    @State private var isComposing: Bool = true
    @State private var constellationRotation: CGSize = .zero
    @State private var lastDragLocation: CGSize = .zero
    
    let dreamWords = [
        ("whisper", 0.7, Color(red: 0.4, green: 0.6, blue: 0.9)),
        ("float", 0.5, Color(red: 0.6, green: 0.4, blue: 0.8)),
        ("memory", 0.9, Color(red: 0.8, green: 0.3, blue: 0.5)),
        ("light", 0.4, Color(red: 0.9, green: 0.8, blue: 0.3)),
        ("shadow", 0.8, Color(red: 0.3, green: 0.3, blue: 0.6)),
        ("echo", 0.6, Color(red: 0.5, green: 0.7, blue: 0.7)),
        ("silence", 0.7, Color(red: 0.4, green: 0.5, blue: 0.7)),
        ("drift", 0.5, Color(red: 0.7, green: 0.5, blue: 0.8)),
        ("moon", 0.6, Color(red: 0.9, green: 0.9, blue: 0.8)),
        ("water", 0.8, Color(red: 0.3, green: 0.6, blue: 0.8))
    ]
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Misty gradient background
                Canvas { context, size in
                    let gradient = Gradient(colors: [
                        Color(red: 0.05, green: 0.05, blue: 0.1),
                        Color(red: 0.1, green: 0.05, blue: 0.15),
                        Color(red: 0.05, green: 0.1, blue: 0.15)
                    ])
                    
                    context.fill(Path(CGRect(origin: .zero, size: size)),
                               with: .linearGradient(gradient,
                                                   startPoint: .zero,
                                                   endPoint: CGPoint(x: size.width, y: size.height)))
                    
                    // Mist layers
                    for i in 0..<5 {
                        let mistOpacity = 0.03 + Double(i) * 0.01
                        let mistPath = Path { path in
                            path.move(to: CGPoint(x: -100, y: size.height * 0.3))
                            
                            for x in stride(from: -100, to: size.width + 100, by: 20) {
                                let y = size.height * 0.3 + sin(x * 0.01 + mistOffset + Double(i) * 0.5) * 50
                                path.addCurve(to: CGPoint(x: x + 20, y: y),
                                            control1: CGPoint(x: x + 10, y: y - 20),
                                            control2: CGPoint(x: x + 10, y: y + 20))
                            }
                            path.addLine(to: CGPoint(x: size.width + 100, y: size.height))
                            path.addLine(to: CGPoint(x: -100, y: size.height))
                            path.closeSubpath()
                        }
                        context.fill(mistPath, with: .color(.white.opacity(mistOpacity)))
                    }
                }
                
                if isComposing {
                    // Memory bubbles
                    ForEach(memoryBubbles) { bubble in
                        MemoryBubbleView(
                            bubble: bubble,
                            isDragging: isDragging == bubble.id,
                            dragOffset: isDragging == bubble.id ? dragOffset : .zero,
                            nearbyBubbles: memoryBubbles.filter { $0.id != bubble.id },
                            pulseTimer: pulseTimer
                        )
                        .position(bubble.position)
                        .offset(isDragging == bubble.id ? dragOffset : .zero)
                        .onDrag {
                            isDragging = bubble.id
                            return NSItemProvider()
                        }
                        .gesture(
                            DragGesture()
                                .onChanged { value in
                                    isDragging = bubble.id
                                    dragOffset = value.translation
                                }
                                .onEnded { value in
                                    if let index = memoryBubbles.firstIndex(where: { $0.id == bubble.id }) {
                                        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                                            memoryBubbles[index].position.x += value.translation.width
                                            memoryBubbles[index].position.y += value.translation.height
                                            checkProximityAndMerge(for: bubble.id)
                                        }
                                    }
                                    isDragging = nil
                                    dragOffset = .zero
                                }
                        )
                    }
                } else if let constellation = dreamConstellation {
                    // 3D Constellation view
                    ConstellationView(constellation: constellation, rotation: constellationRotation)
                        .frame(width: geometry.size.width * 0.8, height: geometry.size.height * 0.8)
                        .position(x: geometry.size.width / 2, y: geometry.size.height / 2)
                        .gesture(
                            DragGesture()
                                .onChanged { value in
                                    let deltaX = value.translation.width - lastDragLocation.width
                                    let deltaY = value.translation.height - lastDragLocation.height
                                    
                                    constellationRotation.width += deltaX * 0.5
                                    constellationRotation.height += deltaY * 0.5
                                    lastDragLocation = value.translation
                                }
                                .onEnded { _ in
                                    lastDragLocation = .zero
                                }
                        )
                }
                
                // UI Controls
                VStack {
                    HStack {
                        Button(action: {
                            withAnimation {
                                isComposing.toggle()
                                if !isComposing && memoryBubbles.count > 0 {
                                    createConstellation()
                                }
                            }
                        }) {
                            Text(isComposing ? "Form Constellation" : "Return to Compose")
                                .padding()
                                .background(Color.white.opacity(0.1))
                                .cornerRadius(10)
                                .foregroundColor(.white)
                        }
                        
                        Spacer()
                        
                        if isComposing {
                            Button(action: { addRandomBubble(in: geometry.size) }) {
                                Image(systemName: "plus.circle")
                                    .font(.title)
                                    .foregroundColor(.white)
                            }
                        }
                    }
                    .padding()
                    
                    Spacer()
                }
            }
        }
        .onAppear {
            startAnimation()
            // Add initial bubbles
            for _ in 0..<5 {
                addRandomBubble(in: CGSize(width: 800, height: 600))
            }
        }
    }
    
    func addRandomBubble(in size: CGSize) {
        let wordData = dreamWords.randomElement() ?? dreamWords[0]
        let bubble = MemoryBubble(
            word: wordData.0,
            opacity: wordData.1,
            color: wordData.2,
            position: CGPoint(
                x: CGFloat.random(in: 100...size.width - 100),
                y: CGFloat.random(in: 100...size.height - 100)
            )
        )
        memoryBubbles.append(bubble)
    }
    
    func checkProximityAndMerge(for bubbleId: UUID) {
        guard let bubbleIndex = memoryBubbles.firstIndex(where: { $0.id == bubbleId }) else { return }
        let bubble = memoryBubbles[bubbleIndex]
        
        for (index, other) in memoryBubbles.enumerated() where other.id != bubbleId {
            let distance = sqrt(pow(bubble.position.x - other.position.x, 2) + pow(bubble.position.y - other.position.y, 2))
            
            if distance < 80 {
                // Merge bubbles
                withAnimation(.easeInOut(duration: 0.5)) {
                    memoryBubbles[bubbleIndex].scale = 1.5
                    memoryBubbles[index].scale = 0.5
                }
                
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    memoryBubbles.removeAll { $0.id == other.id }
                }
            }
        }
    }
    
    func createConstellation() {
        var nodes: [ConstellationNode] = []
        var connections: [(Int, Int)] = []
        
        for (index, bubble) in memoryBubbles.enumerated() {
            let node = ConstellationNode(
                word: bubble.word,
                position: bubble.position,
                depth: Double.random(in: -100...100),
                color: bubble.color
            )
            nodes.append(node)
            
            // Create connections to nearby nodes
            if index > 0 {
                let connectionIndex = Int.random(in: 0..<index)
                connections.append((index, connectionIndex))
            }
        }
        
        dreamConstellation = DreamConstellation(nodes: nodes, connections: connections)
    }
    
    func startAnimation() {
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            mistOffset += 0.5
            pulseTimer += 0.05
        }
    }
}

struct MemoryBubbleView: View {
    let bubble: MemoryBubble
    let isDragging: Bool
    let dragOffset: CGSize
    let nearbyBubbles: [MemoryBubble]
    let pulseTimer: Double
    
    var body: some View {
        ZStack {
            // Glow effect
            Circle()
                .fill(bubble.color.opacity(0.3))
                .frame(width: 80 * bubble.scale, height: 80 * bubble.scale)
                .blur(radius: 20)
            
            // Main bubble
            Circle()
                .fill(
                    RadialGradient(
                        gradient: Gradient(colors: [
                            bubble.color.opacity(bubble.opacity),
                            bubble.color.opacity(bubble.opacity * 0.5)
                        ]),
                        center: .center,
                        startRadius: 0,
                        endRadius: 40
                    )
                )
                .frame(width: 60 * bubble.scale, height: 60 * bubble.scale)
                .overlay(
                    Text(bubble.word)
                        .font(.caption)
                        .foregroundColor(.white)
                        .opacity(0.8)
                )
                .scaleEffect(1 + sin(pulseTimer * 2 + bubble.position.x * 0.01) * 0.05)
        }
        .opacity(isDragging ? 0.8 : 1)
        .animation(.easeInOut(duration: 0.2), value: isDragging)
    }
}

struct ConstellationView: View {
    let constellation: DreamConstellation
    let rotation: CGSize
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Connections
                ForEach(constellation.connections.indices, id: \.self) { index in
                    let connection = constellation.connections[index]
                    let start = transformedPosition(constellation.nodes[connection.0], in: geometry.size)
                    let end = transformedPosition(constellation.nodes[connection.1], in: geometry.size)
                    
                    Path { path in
                        path.move(to: start)
                        path.addLine(to: end)
                    }
                    .stroke(
                        LinearGradient(
                            gradient: Gradient(colors: [
                                constellation.nodes[connection.0].color.opacity(0.3),
                                constellation.nodes[connection.1].color.opacity(0.3)
                            ]),
                            startPoint: .leading,
                            endPoint: .trailing
                        ),
                        lineWidth: 1
                    )
                }
                
                // Nodes
                ForEach(constellation.nodes.indices, id: \.self) { index in
                    let node = constellation.nodes[index]
                    let position = transformedPosition(node, in: geometry.size)
                    let scale = 1 + node.depth / 200
                    
                    ZStack {
                        Circle()
                            .fill(node.color)
                            .frame(width: 20 * scale, height: 20 * scale)
                            .blur(radius: 3)
                        
                        Circle()
                            .fill(node.color)
                            .frame(width: 10 * scale, height: 10 * scale)
                        
                        Text(node.word)
                            .font(.caption2)
                            .foregroundColor(.white)
                            .offset(y: 20 * scale)
                    }
                    .position(position)
                    .opacity(0.8 + node.depth / 500)
                }
            }
        }
    }
    
    func transformedPosition(_ node: ConstellationNode, in size: CGSize) -> CGPoint {
        let centerX = size.width / 2
        let centerY = size.height / 2
        
        let x = node.position.x - centerX
        let y = node.position.y - centerY
        let z = node.depth
        
        // Apply rotation
        let rotX = rotation.width * .pi / 180
        let rotY = rotation.height * .pi / 180
        
        let cosX = cos(rotX)
        let sinX = sin(rotX)
        let cosY = cos(rotY)
        let sinY = sin(rotY)
        
        // Rotate around Y axis
        let x1 = x * cosY - z * sinY
        let z1 = x * sinY + z * cosY
        
        // Rotate around X axis
        let y1 = y * cosX - z1 * sinX
        let z2 = y * sinX + z1 * cosX
        
        // Perspective projection
        let perspective = 500.0
        let scale = perspective / (perspective + z2)
        
        return CGPoint(
            x: centerX + x1 * scale,
            y: centerY + y1 * scale
        )
    }
}