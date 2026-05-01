struct ContentView: View {
    @State private var memories: [MemoryParticle] = []
    @State private var constellations: [Constellation] = []
    @State private var draggedMemory: UUID?
    @State private var hoveredMemory: UUID?
    @State private var viewCenter: CGPoint = CGPoint(x: 720, y: 450)
    @State private var zoom: Double = 1.0
    @State private var isDraggingCanvas: Bool = false
    @State private var lastDragLocation: CGPoint = .zero
    @State private var selectedConstellation: UUID?
    @State private var timeElapsed: Double = 0
    
    let timer = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Deep space background
                Canvas { context, size in
                    let rect = CGRect(origin: .zero, size: size)
                    context.fill(Path(rect), with: .color(Color(red: 0.02, green: 0.02, blue: 0.05)))
                    
                    // Distant star field
                    for i in 0..<200 {
                        let x = Double(i * 7) % size.width
                        let y = Double(i * 13) % size.height
                        let opacity = 0.1 + (Double(i % 3) * 0.1)
                        context.fill(
                            Path(ellipseIn: CGRect(x: x - 0.5, y: y - 0.5, width: 1, height: 1)),
                            with: .color(Color.white.opacity(opacity))
                        )
                    }
                }
                .ignoresSafeArea()
                
                // Memory constellation canvas
                Canvas { context, size in
                    // Draw constellation connections
                    for constellation in constellations {
                        let memoryPositions = memories
                            .filter { constellation.memories.contains($0.id) }
                            .map { $0.position }
                        
                        if memoryPositions.count > 1 {
                            var path = Path()
                            path.move(to: transformPoint(memoryPositions[0], size: size))
                            
                            for i in 1..<memoryPositions.count {
                                path.addLine(to: transformPoint(memoryPositions[i], size: size))
                            }
                            
                            context.stroke(
                                path,
                                with: .color(Color.white.opacity(0.15)),
                                style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [4, 8])
                            )
                        }
                    }
                    
                    // Draw memories as stars
                    for memory in memories {
                        let transformedPos = transformPoint(memory.position, size: size)
                        let baseSize = 4.0 + (memory.gravitationalMass * 2)
                        let glowSize = baseSize * 3
                        
                        // Outer glow
                        context.fill(
                            Path(ellipseIn: CGRect(
                                x: transformedPos.x - glowSize/2,
                                y: transformedPos.y - glowSize/2,
                                width: glowSize,
                                height: glowSize
                            )),
                            with: .radialGradient(
                                Gradient(colors: [
                                    memory.type.color.opacity(memory.brightness * 0.3),
                                    memory.type.color.opacity(0)
                                ]),
                                center: .center
                            )
                        )
                        
                        // Core
                        context.fill(
                            Path(ellipseIn: CGRect(
                                x: transformedPos.x - baseSize/2,
                                y: transformedPos.y - baseSize/2,
                                width: baseSize,
                                height: baseSize
                            )),
                            with: .color(memory.type.color.opacity(memory.brightness))
                        )
                        
                        // Inner bright point
                        context.fill(
                            Path(ellipseIn: CGRect(
                                x: transformedPos.x - 1,
                                y: transformedPos.y - 1,
                                width: 2,
                                height: 2
                            )),
                            with: .color(Color.white.opacity(memory.brightness * 0.9))
                        )
                    }
                }
                .ignoresSafeArea()
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            if draggedMemory == nil {
                                isDraggingCanvas = true
                                let delta = CGSize(
                                    width: value.location.x - lastDragLocation.x,
                                    height: value.location.y - lastDragLocation.y
                                )
                                viewCenter.x -= delta.width / zoom
                                viewCenter.y -= delta.height / zoom
                                lastDragLocation = value.location
                            }
                        }
                        .onEnded { _ in
                            isDraggingCanvas = false
                        }
                )
                .onAppear {
                    generateInitialMemories()
                }
                
                // Memory interaction overlays
                ForEach(memories) { memory in
                    Circle()
                        .fill(Color.clear)
                        .frame(width: 20, height: 20)
                        .position(transformPoint(memory.position, size: geometry.size))
                        .onHover { hovering in
                            hoveredMemory = hovering ? memory.id : nil
                        }
                        .gesture(
                            DragGesture()
                                .onChanged { value in
                                    draggedMemory = memory.id
                                    if let index = memories.firstIndex(where: { $0.id == memory.id }) {
                                        memories[index].position = inverseTransformPoint(value.location, size: geometry.size)
                                    }
                                }
                                .onEnded { _ in
                                    draggedMemory = nil
                                }
                        )
                }
            }
            .onReceive(timer) { _ in
                updatePhysics()
                timeElapsed += 0.05
            }
        }
    }
    
    func transformPoint(_ point: CGPoint, size: CGSize) -> CGPoint {
        let x = (point.x - viewCenter.x) * zoom + size.width / 2
        let y = (point.y - viewCenter.y) * zoom + size.height / 2
        return CGPoint(x: x, y: y)
    }
    
    func inverseTransformPoint(_ point: CGPoint, size: CGSize) -> CGPoint {
        let x = (point.x - size.width / 2) / zoom + viewCenter.x
        let y = (point.y - size.height / 2) / zoom + viewCenter.y
        return CGPoint(x: x, y: y)
    }
    
    func generateInitialMemories() {
        for i in 0..<20 {
            let angle = Double(i) * .pi * 2 / 20
            let radius = 200 + Double.random(in: -50...50)
            let position = CGPoint(
                x: viewCenter.x + cos(angle) * radius,
                y: viewCenter.y + sin(angle) * radius
            )
            
            let memory = MemoryParticle(
                position: position,
                gravitationalMass: Double.random(in: 0.5...2.0),
                brightness: Double.random(in: 0.5...1.0),
                type: MemoryType.allCases.randomElement()!
            )
            memories.append(memory)
        }
        
        // Create a few constellations
        if memories.count >= 5 {
            let constellation1 = Constellation(
                memories: Set(memories[0..<5].map { $0.id }),
                name: "First Memory"
            )
            constellations.append(constellation1)
        }
    }
    
    func updatePhysics() {
        guard draggedMemory == nil else { return }
        
        for i in 0..<memories.count {
            var totalForce = CGVector(dx: 0, dy: 0)
            
            for j in 0..<memories.count where i != j {
                let dx = memories[j].position.x - memories[i].position.x
                let dy = memories[j].position.y - memories[i].position.y
                let distanceSquared = max(dx * dx + dy * dy, 100)
                let distance = sqrt(distanceSquared)
                
                let forceMagnitude = 0.1 * memories[i].gravitationalMass * memories[j].gravitationalMass / distanceSquared
                totalForce.dx += forceMagnitude * dx / distance
                totalForce.dy += forceMagnitude * dy / distance
            }
            
            memories[i].velocity.dx += totalForce.dx * 0.05
            memories[i].velocity.dy += totalForce.dy * 0.05
            memories[i].velocity.dx *= 0.98
            memories[i].velocity.dy *= 0.98
            
            memories[i].position.x += memories[i].velocity.dx
            memories[i].position.y += memories[i].velocity.dy
            
            memories[i].brightness = 0.5 + 0.5 * sin(timeElapsed * 2 + Double(i))
        }
    }
}