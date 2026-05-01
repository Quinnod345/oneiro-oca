struct ContentView: View {
    @State private var memories: [PolaroidMemory] = []
    @State private var selectedMemory: UUID?
    @State private var memoryInputs: [UUID: String] = [:]
    @State private var mouseLocation: CGPoint = .zero
    
    let memoryImages = [
        "summer afternoon by the lake",
        "grandmother's kitchen",
        "first day of school",
        "wedding dance floor",
        "childhood bedroom",
        "family road trip"
    ]
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Subtle gradient background
                LinearGradient(
                    colors: [
                        Color(red: 0.05, green: 0.05, blue: 0.08),
                        Color.black
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()
                
                // Memory polaroids
                ForEach(memories) { memory in
                    PolaroidView(
                        memory: memory,
                        isSelected: selectedMemory == memory.id,
                        mouseDistance: distance(from: mouseLocation, to: memory.position)
                    )
                    .position(memory.position)
                    .onTapGesture {
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                            selectedMemory = selectedMemory == memory.id ? nil : memory.id
                        }
                    }
                }
                
                // Selected memory detail
                if let selected = selectedMemory,
                   let memory = memories.first(where: { $0.id == selected }) {
                    VStack(spacing: 0) {
                        Spacer()
                        
                        VStack(spacing: 20) {
                            Text(memory.caption)
                                .font(.system(size: 18, weight: .medium))
                                .foregroundColor(.white.opacity(0.9))
                            
                            TextField("What do you remember?", text: Binding(
                                get: { memoryInputs[selected] ?? "" },
                                set: { memoryInputs[selected] = $0 }
                            ))
                            .textFieldStyle(PlainTextFieldStyle())
                            .font(.system(size: 16))
                            .foregroundColor(.white.opacity(0.8))
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                            .background(
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(Color.white.opacity(0.1))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 8)
                                            .stroke(Color.white.opacity(0.2), lineWidth: 1)
                                    )
                            )
                            .frame(width: 400)
                        }
                        .padding(40)
                        .background(
                            RoundedRectangle(cornerRadius: 16)
                                .fill(.ultraThinMaterial)
                                .opacity(0.9)
                        )
                        .padding(.bottom, 60)
                    }
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
                }
            }
            .onAppear {
                initializeMemories(in: geometry.size)
            }
            .onContinuousHover { phase in
                switch phase {
                case .active(let location):
                    mouseLocation = CGPoint(x: location.x, y: location.y)
                case .ended:
                    break
                }
            }
        }
        .frame(width: 1440, height: 900)
    }
    
    func initializeMemories(in size: CGSize) {
        memories = memoryImages.enumerated().map { index, caption in
            let age = TimeInterval(index) * 2.0 + 1.0
            let gridX = index % 3
            let gridY = index / 3
            let xSpacing = size.width / 4
            let ySpacing = size.height / 3
            let xOffset = (size.width - (2 * xSpacing)) / 2
            let yOffset = (size.height - ySpacing) / 2
            
            return PolaroidMemory(
                id: UUID(),
                caption: caption,
                age: age,
                position: CGPoint(
                    x: xOffset + CGFloat(gridX) * xSpacing,
                    y: yOffset + CGFloat(gridY) * ySpacing
                ),
                rotation: Double.random(in: -5...5),
                decayLevel: min(age * 0.1, 0.8)
            )
        }
    }
    
    func distance(from: CGPoint, to: CGPoint) -> CGFloat {
        hypot(from.x - to.x, from.y - to.y)
    }
}

struct PolaroidMemory: Identifiable {
    let id: UUID
    let caption: String
    let age: TimeInterval
    let position: CGPoint
    let rotation: Double
    let decayLevel: Double
}

struct PolaroidView: View {
    let memory: PolaroidMemory
    let isSelected: Bool
    let mouseDistance: CGFloat
    
    private var proximityScale: CGFloat {
        let maxDistance: CGFloat = 200
        let scale = 1 - min(mouseDistance / maxDistance, 1)
        return 1 + (scale * 0.1)
    }
    
    private var fadedOpacity: Double {
        1.0 - memory.decayLevel * 0.5
    }
    
    var body: some View {
        VStack(spacing: 0) {
            // Photo area
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [
                            Color(white: 0.2),
                            Color(white: 0.15)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: 180, height: 180)
                .overlay(
                    Text(memory.caption)
                        .font(.system(size: 14, weight: .light))
                        .foregroundColor(.white.opacity(0.3))
                        .multilineTextAlignment(.center)
                        .padding(20)
                        .opacity(fadedOpacity)
                )
            
            // Caption area
            Rectangle()
                .fill(Color(white: 0.95))
                .frame(width: 180, height: 40)
                .overlay(
                    Text(formattedAge)
                        .font(.system(size: 12, weight: .regular))
                        .foregroundColor(Color(white: 0.3))
                        .opacity(fadedOpacity)
                )
        }
        .background(
            RoundedRectangle(cornerRadius: 2)
                .fill(Color.white)
                .shadow(
                    color: .black.opacity(isSelected ? 0.5 : 0.3),
                    radius: isSelected ? 20 : 10,
                    x: 0,
                    y: isSelected ? 10 : 5
                )
        )
        .rotationEffect(.degrees(memory.rotation))
        .scaleEffect(isSelected ? 1.15 : proximityScale)
        .animation(.easeOut(duration: 0.2), value: proximityScale)
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: isSelected)
    }
    
    private var formattedAge: String {
        let years = Int(memory.age)
        return years == 1 ? "1 year ago" : "\(years) years ago"
    }
}