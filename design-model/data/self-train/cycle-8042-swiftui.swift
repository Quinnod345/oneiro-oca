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
    
    let timer = Timer.publish(every: 0.016, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            
            StarField(count: 200)
                .allowsHitTesting(false)
            
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
                            
                            context.stroke(
                                path,
                                with: .color(.white.opacity(0.3)),
                                style: StrokeStyle(lineWidth: 1 * zoomScale, dash: [5, 5])
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
                        with: .color(.white.opacity(0.6)),
                        style: StrokeStyle(lineWidth: 2 * zoomScale, dash: [10, 5])
                    )
                }
                
                // Draw memories
                for memory in memories {
                    let position = CGPoint(
                        x: memory.position.x * zoomScale + offset.width,
                        y: memory.position.y * zoomScale + offset.height
                    )
                    
                    let baseSize = 20.0 + memory.intensity * 30.0
                    let size = baseSize * zoomScale
                    
                    // Outer glow
                    let glowGradient = RadialGradient(
                        colors: [
                            memory.emotion.color.opacity(0.3),
                            memory.emotion.color.opacity(0.0)
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: size * 2
                    )
                    
                    context.fill(
                        Path(ellipseIn: CGRect(
                            x: position.x - size * 2,
                            y: position.y - size * 2,
                            width: size * 4,
                            height: size * 4
                        )),
                        with: .radialGradient(glowGradient)
                    )
                    
                    // Core star
                    let coreGradient = RadialGradient(
                        colors: [
                            .white,
                            memory.emotion.color,
                            memory.emotion.color.opacity(0.8)
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: size
                    )
                    
                    context.fill(
                        Path(ellipseIn: CGRect(
                            x: position.x - size,
                            y: position.y - size,
                            width: size * 2,
                            height: size * 2
                        )),
                        with: .radialGradient(coreGradient)
                    )
                }
            }
            
            // Interactive memory views
            ForEach(memories) { memory in
                MemoryView(
                    memory: memory,
                    isSelected: selectedMemory?.id == memory.id,
                    isHovered: hoveredMemory == memory.id,
                    scale: zoomScale,
                    offset: offset
                )
                .position(
                    x: memory.position.x * zoomScale + offset.width,
                    y: memory.position.y * zoomScale + offset.height
                )
                .onTapGesture {
                    withAnimation(.spring()) {
                        selectedMemory = selectedMemory?.id == memory.id ? nil : memory
                    }
                }
                .onHover { isHovering in
                    hoveredMemory = isHovering ? memory.id : nil
                }
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            if draggedMemory == nil {
                                draggedMemory = memory.id
                            }
                            if draggedMemory == memory.id {
                                if let index = memories.firstIndex(where: { $0.id == memory.id }) {
                                    memories[index].position = CGPoint(
                                        x: (value.location.x - offset.width) / zoomScale,
                                        y: (value.location.y - offset.height) / zoomScale
                                    )
                                }
                            }
                        }
                        .onEnded { _ in
                            draggedMemory = nil
                        }
                )
                .contextMenu {
                    Button("Connect Memory") {
                        isDrawingPath = true
                        pathStart = memory.id
                    }
                    Button("Clear Connections") {
                        if let index = memories.firstIndex(where: { $0.id == memory.id }) {
                            memories[index].connections.removeAll()
                        }
                    }
                }
            }
            
            // UI Controls
            VStack {
                HStack {
                    // Zoom controls
                    HStack(spacing: 10) {
                        Button(action: { withAnimation { zoomScale *= 1.2 } }) {
                            Image(systemName: "plus.circle")
                                .font(.title2)
                                .foregroundColor(.white)
                        }
                        Text("\(Int(zoomScale * 100))%")
                            .foregroundColor(.white)
                            .frame(width: 50)
                        Button(action: { withAnimation { zoomScale *= 0.8 } }) {
                            Image(systemName: "minus.circle")
                                .font(.title2)
                                .foregroundColor(.white)
                        }
                        Button(action: { withAnimation { zoomScale = 1.0; offset = .zero } }) {
                            Image(systemName: "arrow.counterclockwise.circle")
                                .font(.title2)
                                .foregroundColor(.white)
                        }
                    }
                    .padding()
                    .background(Color.black.opacity(0.7))
                    .cornerRadius(10)
                    
                    Spacer()
                    
                    // Gravity toggle
                    Toggle(isOn: $gravityEnabled) {
                        Label("Gravity", systemImage: "arrow.down.circle")
                            .foregroundColor(.white)
                    }
                    .toggleStyle(.button)
                    .tint(.purple)
                    .padding()
                    .background(Color.black.opacity(0.7))
                    .cornerRadius(10)
                }
                .padding()
                
                Spacer()
                
                // Selected memory details
                if let selected = selectedMemory {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(selected.content)
                            .font(.title2)
                            .fontWeight(.bold)
                            .foregroundColor(.white)
                        
                        HStack {
                            Label("Intensity", systemImage: "flame")
                            Slider(value: .constant(selected.intensity), in: 0...1)
                                .disabled(true)
                                .tint(selected.emotion.color)
                        }
                        
                        HStack {
                            Label("Clarity", systemImage: "eye")
                            ProgressView(value: selected.clarity)
                                .tint(.white)
                        }
                        
                        HStack {
                            Text("Emotion: \(emotionName(selected.emotion))")
                            Circle()
                                .fill(selected.emotion.color)
                                .frame(width: 20, height: 20)
                        }
                    }
                    .foregroundColor(.white)
                    .padding()
                    .background(Color.black.opacity(0.8))
                    .cornerRadius(15)
                    .padding()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
        .gesture(
            DragGesture()
                .onChanged { value in
                    if !isDrawingPath {
                        offset = CGSize(
                            width: value.translation.width + value.startLocation.x - value.location.x,
                            height: value.translation.height + value.startLocation.y - value.location.y
                        )
                    }
                }
        )
        .onReceive(timer) { _ in
            if gravityEnabled {
                applyGravity()
            }
            updateMemoryAges()
        }
        .onTapGesture { location in
            if isDrawingPath, let startId = pathStart {
                // Find if we clicked on a memory
                for memory in memories {
                    let memoryPos = CGPoint(
                        x: memory.position.x * zoomScale + offset.width,
                        y: memory.position.y * zoomScale + offset.height
                    )
                    let distance = sqrt(pow(location.x - memoryPos.x, 2) + pow(location.y - memoryPos.y, 2))
                    
                    if distance < 50 * zoomScale && memory.id != startId {
                        // Create connection
                        if let startIndex = memories.firstIndex(where: { $0.id == startId }) {
                            if !memories[startIndex].connections.contains(memory.id) {
                                memories[startIndex].connections.append(memory.id)
                            }
                        }
                        break
                    }
                }
                
                isDrawingPath = false
                pathStart = nil
            }
        }
        .onContinuousHover { phase in
            if isDrawingPath {
                switch phase {
                case .active(let location):
                    currentPathPoint = location
                case .ended:
                    break
                }
            }
        }
    }
    
    func emotionName(_ emotion: Emotion) -> String {
        switch emotion {
        case .joy: return "Joy"
        case .fear: return "Fear"
        case .love: return "Love"
        case .melancholy: return "Melancholy"
        case .wonder: return "Wonder"
        case .nostalgia: return "Nostalgia"
        }
    }
    
    func applyGravity() {
        for i in 0..<memories.count {
            memories[i].velocity.y += 0.1
            memories[i].position.x += memories[i].velocity.x
            memories[i].position.y += memories[i].velocity.y
            
            // Damping
            memories[i].velocity.x *= 0.99
            memories[i].velocity.y *= 0.99
            
            // Bounds checking
            if memories[i].position.y > 800 {
                memories[i].position.y = 800
                memories[i].velocity.y *= -0.5
            }
        }
    }
    
    func updateMemoryAges() {
        for i in 0..<memories.count {
            memories[i].age += 0.016
        }
    }
}

struct MemoryView: View {
    let memory: Memory
    let isSelected: Bool
    let isHovered: Bool
    let scale: Double
    let offset: CGSize
    
    var body: some View {
        ZStack {
            // Invisible hit area
            Circle()
                .fill(Color.clear)
                .frame(
                    width: (40 + memory.intensity * 60) * scale,
                    height: (40 + memory.intensity * 60) * scale
                )
            
            // Selection indicator
            if isSelected {
                Circle()
                    .stroke(memory.emotion.color, lineWidth: 3 * scale)
                    .frame(
                        width: (50 + memory.intensity * 70) * scale,
                        height: (50 + memory.intensity * 70) * scale
                    )
                    .animation(.easeInOut(duration: 0.3), value: isSelected)
            }
            
            // Hover effect
            if isHovered {
                Text(memory.content)
                    .font(.caption)
                    .foregroundColor(.white)
                    .padding(8)
                    .background(Color.black.opacity(0.8))
                    .cornerRadius(8)
                    .offset(y: -(40 + memory.intensity * 40) * scale)
            }
        }
    }
}