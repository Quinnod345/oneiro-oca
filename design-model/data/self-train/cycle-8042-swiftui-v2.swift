struct ContentView: View {
    @State private var memories: [Memory] = [
        Memory(content: "First day of school, trembling hands", position: CGPoint(x: 300, y: 200), intensity: 0.8, emotion: .fear, clarity: 0.6, connections: []),
        Memory(content: "Grandmother's kitchen, flour everywhere", position: CGPoint(x: 700, y: 150), intensity: 0.9, emotion: .love, clarity: 0.9, connections: []),
        Memory(content: "That summer storm, power went out", position: CGPoint(x: 500, y: 400), intensity: 0.7, emotion: .wonder, clarity: 0.5, connections: []),
        Memory(content: "Broken bicycle, dad's patient hands", position: CGPoint(x: 900, y: 300), intensity: 0.6, emotion: .melancholy, clarity: 0.8, connections: []),
        Memory(content: "Victory dance, championship game", position: CGPoint(x: 400, y: 600), intensity: 1.0, emotion: .joy, clarity: 0.95, connections: []),
        Memory(content: "Lost in the mall, fluorescent terror", position: CGPoint(x: 1100, y: 500), intensity: 0.85, emotion: .fear, clarity: 0.4, connections: [])
    ]
    
    @State private var selectedMemory: Memory?
    @State private var hoveredMemory: UUID?
    @State private var zoomScale: Double = 1.0
    @State private var offset: CGSize = .zero
    @State private var draggedMemory: UUID?
    @State private var isDrawingPath: Bool = false
    @State private var pathStart: UUID?
    @State private var currentPathPoint: CGPoint = .zero
    @State private var gravityEnabled: Bool = true
    @State private var showingMemoryDetail: Bool = false
    
    let timer = Timer.publish(every: 0.016, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            
            EmotionalBackground(memories: memories)
                .ignoresSafeArea()
                .opacity(0.8)
            
            GeometryReader { geometry in
                ZStack {
                    Canvas { context, size in
                        // Draw connections
                        for memory in memories {
                            let fromPoint = CGPoint(
                                x: memory.position.x * zoomScale + offset.width,
                                y: memory.position.y * zoomScale + offset.height
                            )
                            
                            for connectionId in memory.connections {
                                if let connectedMemory = memories.first(where: { $0.id == connectionId }) {
                                    let toPoint = CGPoint(
                                        x: connectedMemory.position.x * zoomScale + offset.width,
                                        y: connectedMemory.position.y * zoomScale + offset.height
                                    )
                                    
                                    var path = Path()
                                    path.move(to: fromPoint)
                                    path.addQuadCurve(
                                        to: toPoint,
                                        control: CGPoint(
                                            x: (fromPoint.x + toPoint.x) / 2,
                                            y: (fromPoint.y + toPoint.y) / 2 - 50 * zoomScale
                                        )
                                    )
                                    
                                    let gradient = LinearGradient(
                                        colors: [
                                            memory.emotion.color.opacity(0.4),
                                            connectedMemory.emotion.color.opacity(0.4)
                                        ],
                                        startPoint: .zero,
                                        endPoint: CGPoint(x: 1, y: 0)
                                    )
                                    
                                    context.stroke(
                                        path,
                                        with: .linearGradient(gradient, startPoint: fromPoint, endPoint: toPoint),
                                        style: StrokeStyle(lineWidth: 2 * zoomScale, lineCap: .round)
                                    )
                                }
                            }
                        }
                        
                        // Draw current path being created
                        if isDrawingPath, let startId = pathStart,
                           let startMemory = memories.first(where: { $0.id == startId }) {
                            let fromPoint = CGPoint(
                                x: startMemory.position.x * zoomScale + offset.width,
                                y: startMemory.position.y * zoomScale + offset.height
                            )
                            
                            var path = Path()
                            path.move(to: fromPoint)
                            path.addLine(to: currentPathPoint)
                            
                            context.stroke(
                                path,
                                with: .color(startMemory.emotion.color.opacity(0.6)),
                                style: StrokeStyle(
                                    lineWidth: 3 * zoomScale,
                                    lineCap: .round,
                                    dash: [10, 5],
                                    dashPhase: 0
                                )
                            )
                        }
                    }
                    
                    // Memory nodes
                    ForEach($memories) { $memory in
                        MemoryNode(
                            memory: memory,
                            isHovered: hoveredMemory == memory.id,
                            isDragging: draggedMemory == memory.id,
                            zoomScale: zoomScale,
                            offset: offset
                        )
                        .position(
                            x: memory.position.x * zoomScale + offset.width,
                            y: memory.position.y * zoomScale + offset.height
                        )
                        .onTapGesture {
                            selectedMemory = memory
                            showingMemoryDetail = true
                        }
                        .onHover { hovering in
                            withAnimation(.easeOut(duration: 0.2)) {
                                hoveredMemory = hovering ? memory.id : nil
                            }
                        }
                        .gesture(
                            DragGesture()
                                .onChanged { value in
                                    if !isDrawingPath {
                                        draggedMemory = memory.id
                                        memory.position = CGPoint(
                                            x: (value.location.x - offset.width) / zoomScale,
                                            y: (value.location.y - offset.height) / zoomScale
                                        )
                                    }
                                }
                                .onEnded { _ in
                                    draggedMemory = nil
                                }
                        )
                        .gesture(
                            LongPressGesture(minimumDuration: 0.5)
                                .sequenced(before: DragGesture())
                                .onChanged { value in
                                    switch value {
                                    case .first:
                                        isDrawingPath = true
                                        pathStart = memory.id
                                    case .second(_, let drag):
                                        if let drag = drag {
                                            currentPathPoint = drag.location
                                        }
                                    }
                                }
                                .onEnded { value in
                                    if case .second = value {
                                        // Find memory at drop location
                                        for targetMemory in memories {
                                            let targetPos = CGPoint(
                                                x: targetMemory.position.x * zoomScale + offset.width,
                                                y: targetMemory.position.y * zoomScale + offset.height
                                            )
                                            
                                            let distance = sqrt(
                                                pow(currentPathPoint.x - targetPos.x, 2) +
                                                pow(currentPathPoint.y - targetPos.y, 2)
                                            )
                                            
                                            if distance < 50 && targetMemory.id != memory.id {
                                                if !memory.connections.contains(targetMemory.id) {
                                                    memory.connections.append(targetMemory.id)
                                                }
                                                break
                                            }
                                        }
                                    }
                                    isDrawingPath = false
                                    pathStart = nil
                                }
                        )
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.clear)
                .gesture(
                    MagnificationGesture()
                        .onChanged { value in
                            zoomScale = max(0.5, min(2.0, value))
                        }
                )
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            if !isDrawingPath && draggedMemory == nil {
                                offset = CGSize(
                                    width: value.translation.width,
                                    height: value.translation.height
                                )
                            }
                        }
                )
            }
            
            // UI Controls
            VStack {
                HStack {
                    Text("MEMORY CONSTELLATION")
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundColor(.white.opacity(0.8))
                        .tracking(2)
                    
                    Spacer()
                    
                    HStack(spacing: 16) {
                        Button(action: { gravityEnabled.toggle() }) {
                            Image(systemName: gravityEnabled ? "arrow.down.circle.fill" : "arrow.down.circle")
                                .font(.title2)
                                .foregroundColor(.white.opacity(0.8))
                        }
                        
                        Button(action: resetView) {
                            Image(systemName: "arrow.counterclockwise")
                                .font(.title2)
                                .foregroundColor(.white.opacity(0.8))
                        }
                    }
                }
                .padding()
                
                Spacer()
                
                HStack {
                    Text("Hold & drag to connect memories")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.5))
                    
                    Spacer()
                    
                    Text("Zoom: \(String(format: "%.0f", zoomScale * 100))%")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.5))
                }
                .padding()
            }
            
            // Memory detail overlay
            if showingMemoryDetail, let memory = selectedMemory {
                Color.black.opacity(0.6)
                    .ignoresSafeArea()
                    .onTapGesture {
                        showingMemoryDetail = false
                    }
                
                MemoryDetailView(memory: memory) {
                    showingMemoryDetail = false
                }
            }
        }
        .onReceive(timer) { _ in
            if gravityEnabled && !isDrawingPath && draggedMemory == nil {
                applyGravity()
            }
        }
    }
    
    func applyGravity() {
        let centerX = 600.0
        let centerY = 400.0
        let gravityStrength = 0.1
        let repulsionStrength = 50.0
        let damping = 0.95
        
        for i in 0..<memories.count {
            // Attraction to center
            let dx = centerX - memories[i].position.x
            let dy = centerY - memories[i].position.y
            let distance = sqrt(dx * dx + dy * dy)
            
            if distance > 1 {
                memories[i].velocity.x += (dx / distance) * gravityStrength
                memories[i].velocity.y += (dy / distance) * gravityStrength
            }
            
            // Repulsion between nodes
            for j in 0..<memories.count where i != j {
                let dx = memories[i].position.x - memories[j].position.x
                let dy = memories[i].position.y - memories[j].position.y
                let distance = sqrt(dx * dx + dy * dy)
                
                if distance < 150 && distance > 0 {
                    let force = repulsionStrength / (distance * distance)
                    memories[i].velocity.x += (dx / distance) * force
                    memories[i].velocity.y += (dy / distance) * force
                }
            }
            
            // Apply velocity with damping
            memories[i].velocity.x *= damping
            memories[i].velocity.y *= damping
            
            memories[i].position.x += memories[i].velocity.x
            memories[i].position.y += memories[i].velocity.y
        }
    }
    
    func resetView() {
        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
            zoomScale = 1.0
            offset = .zero
        }
    }
}

struct MemoryNode: View {
    let memory: Memory
    let isHovered: Bool
    let isDragging: Bool
    let zoomScale: Double
    let offset: CGSize
    @State private var pulseScale: Double = 1.0
    
    var body: some View {
        ZStack {
            // Outer glow
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            memory.emotion.color.opacity(0.4 * memory.clarity),
                            memory.emotion.color.opacity(0.1),
                            Color.clear
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: 50
                    )
                )
                .frame(width: 100 * zoomScale, height: 100 * zoomScale)
                .blur(radius: 10)
                .scaleEffect(pulseScale)
            
            // Core
            Circle()
                .fill(memory.emotion.color)
                .frame(
                    width: (20 + memory.intensity * 30) * zoomScale,
                    height: (20 + memory.intensity * 30) * zoomScale
                )
                .overlay(
                    Circle()
                        .stroke(
                            LinearGradient(
                                colors: [
                                    .white.opacity(0.6),
                                    memory.emotion.color.opacity(0.8)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 2 * zoomScale
                        )
                )
                .scaleEffect(isDragging ? 1.2 : (isHovered ? 1.1 : 1.0))
                .shadow(
                    color: memory.emotion.color,
                    radius: isHovered ? 20 : 10,
                    x: 0,
                    y: 0
                )
            
            // Clarity indicator
            ForEach(0..<Int(memory.clarity * 5)) { index in
                Circle()
                    .fill(.white.opacity(0.6))
                    .frame(width: 3 * zoomScale, height: 3 * zoomScale)
                    .offset(
                        x: cos(Double(index) * .pi / 2.5) * (15 + memory.intensity * 20) * zoomScale,
                        y: sin(Double(index) * .pi / 2.5) * (15 + memory.intensity * 20) * zoomScale
                    )
            }
        }
        .onAppear {
            withAnimation(
                .easeInOut(duration: 2 + memory.intensity)
                .repeatForever(autoreverses: true)
            ) {
                pulseScale = 1.1 + memory.intensity * 0.1
            }
        }
    }
}