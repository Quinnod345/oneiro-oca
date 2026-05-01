struct ContentView: View {
    @State private var memories: [Memory] = [
        Memory(content: "First day of school", detail: "yellow raincoat", clarity: 0.3, position: CGPoint(x: 0.25, y: 0.4)),
        Memory(content: "Mom's lullaby", detail: "moonlight through curtains", clarity: 0.7, position: CGPoint(x: 0.75, y: 0.5)),
        Memory(content: "Dad teaching me to ride", detail: "scraped knees", clarity: 0.15, position: CGPoint(x: 0.5, y: 0.6))
    ]
    
    @State private var mergeSource: UUID?
    @State private var mergeTarget: UUID?
    @State private var isPinching: Bool = false
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color(red: 0.05, green: 0.05, blue: 0.08)
                    .ignoresSafeArea()
                
                ForEach(memories.indices, id: \.self) { index in
                    let memory = memories[index]
                    let size = memorySize(for: memory.clarity, in: geometry)
                    let position = CGPoint(
                        x: memory.position.x * geometry.size.width,
                        y: memory.position.y * geometry.size.height
                    )
                    
                    PolaroidView(memory: memory)
                        .frame(width: size, height: size * 1.2)
                        .position(position)
                        .scaleEffect(mergeSource == memory.id || mergeTarget == memory.id ? 1.1 : 1.0)
                        .shadow(color: .white.opacity(memory.clarity * 0.2), radius: 20)
                        .onLongPressGesture(minimumDuration: 0.5) {
                            withAnimation(.easeInOut(duration: 0.6)) {
                                memories[index].clarity = min(1.0, memory.clarity + 0.2)
                            }
                        }
                        .gesture(
                            DragGesture()
                                .onChanged { value in
                                    memories[index].position = CGPoint(
                                        x: value.location.x / geometry.size.width,
                                        y: value.location.y / geometry.size.height
                                    )
                                    checkProximity(index: index, in: geometry)
                                }
                                .onEnded { _ in
                                    if mergeSource != nil && mergeTarget != nil {
                                        performMerge()
                                    } else {
                                        resetMerge()
                                    }
                                }
                        )
                }
                
                VStack {
                    HStack {
                        Text("hold to remember • drag to merge")
                            .font(.system(size: 14, weight: .light, design: .serif))
                            .foregroundColor(.white.opacity(0.3))
                            .padding()
                        Spacer()
                    }
                    Spacer()
                }
            }
        }
    }
    
    func memorySize(for clarity: Double, in geometry: GeometryProxy) -> CGFloat {
        let minSize: CGFloat = 150
        let maxSize: CGFloat = 300
        return minSize + (maxSize - minSize) * CGFloat(clarity)
    }
    
    func checkProximity(index: Int, in geometry: GeometryProxy) {
        let draggedMemory = memories[index]
        let draggedPoint = CGPoint(
            x: draggedMemory.position.x * geometry.size.width,
            y: draggedMemory.position.y * geometry.size.height
        )
        
        resetMerge()
        
        for (otherIndex, otherMemory) in memories.enumerated() where otherIndex != index {
            let otherPoint = CGPoint(
                x: otherMemory.position.x * geometry.size.width,
                y: otherMemory.position.y * geometry.size.height
            )
            
            let distance = sqrt(pow(draggedPoint.x - otherPoint.x, 2) + pow(draggedPoint.y - otherPoint.y, 2))
            
            if distance < 100 {
                withAnimation(.easeInOut(duration: 0.3)) {
                    mergeSource = draggedMemory.id
                    mergeTarget = otherMemory.id
                }
                break
            }
        }
    }
    
    func performMerge() {
        guard let sourceId = mergeSource,
              let targetId = mergeTarget,
              let sourceIndex = memories.firstIndex(where: { $0.id == sourceId }),
              let targetIndex = memories.firstIndex(where: { $0.id == targetId }) else {
            return
        }
        
        withAnimation(.easeInOut(duration: 0.8)) {
            let sourceClarity = memories[sourceIndex].clarity
            let targetClarity = memories[targetIndex].clarity
            
            memories[targetIndex].clarity = min(1.0, targetClarity + sourceClarity * 0.5)
            memories[sourceIndex].clarity = max(0.05, sourceClarity * 0.3)
            
            if memories[sourceIndex].clarity < 0.1 {
                memories.remove(at: sourceIndex)
            }
        }
        
        resetMerge()
    }
    
    func resetMerge() {
        withAnimation(.easeOut(duration: 0.2)) {
            mergeSource = nil
            mergeTarget = nil
        }
    }
}

struct PolaroidView: View {
    let memory: Memory
    
    var body: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.9 - memory.clarity * 0.3,
                                  green: 0.85 - memory.clarity * 0.2,
                                  blue: 0.75 - memory.clarity * 0.1),
                            Color(red: 0.8 - memory.clarity * 0.4,
                                  green: 0.75 - memory.clarity * 0.3,
                                  blue: 0.65 - memory.clarity * 0.2)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    Text(memory.content)
                        .font(.system(size: 16, weight: .medium, design: .serif))
                        .foregroundColor(.black.opacity(memory.clarity))
                        .multilineTextAlignment(.center)
                        .padding()
                        .blur(radius: (1 - memory.clarity) * 3)
                )
                .aspectRatio(1, contentMode: .fit)
            
            Text(memory.detail)
                .font(.system(size: 12, weight: .light, design: .serif))
                .foregroundColor(.black.opacity(memory.clarity * 0.6))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(Color.white.opacity(0.9 - (1 - memory.clarity) * 0.3))
        }
        .background(Color.white)
        .overlay(
            Rectangle()
                .stroke(Color.white.opacity(0.3), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.3), radius: 5, x: 2, y: 2)
        .rotation3DEffect(
            .degrees(5),
            axis: (x: 1, y: 1, z: 0)
        )
    }
}

struct Memory: Identifiable {
    let id = UUID()
    var content: String
    var detail: String
    var clarity: Double
    var position: CGPoint
}