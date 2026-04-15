struct MemoryFragment: Identifiable {
    let id = UUID()
    let text: String
    let position: CGPoint
    let maxViews: Int
    var viewCount: Int = 0
    var lastHovered: Date = Date()
    var opacity: Double = 0.9
}

struct MemoryRegion: Identifiable {
    let id = UUID()
    let center: CGPoint
    let radius: Double
    let intensity: Double
}

struct ContentView: View {
    @State private var memories: [MemoryFragment] = [
        MemoryFragment(text: "the smell of her pancakes on Sunday morning", position: CGPoint(x: 320, y: 180), maxViews: 3),
        MemoryFragment(text: "hiding under the kitchen table during thunderstorms", position: CGPoint(x: 890, y: 240), maxViews: 2),
        MemoryFragment(text: "the creak of the third stair when sneaking downstairs", position: CGPoint(x: 540, y: 420), maxViews: 4),
        MemoryFragment(text: "dad's cologne mixed with sawdust from the garage", position: CGPoint(x: 200, y: 580), maxViews: 2),
        MemoryFragment(text: "the pattern of sunlight through lace curtains", position: CGPoint(x: 1100, y: 520), maxViews: 5),
        MemoryFragment(text: "counting fireflies from the porch swing", position: CGPoint(x: 720, y: 680), maxViews: 3),
        MemoryFragment(text: "the weight of her hand on my forehead checking for fever", position: CGPoint(x: 450, y: 280), maxViews: 1),
        MemoryFragment(text: "racing bikes until the streetlights came on", position: CGPoint(x: 980, y: 380), maxViews: 3)
    ]
    
    @State private var regions: [MemoryRegion] = []
    @State private var cursorPosition: CGPoint = .zero
    @State private var brushPower: Double = 1.0
    @State private var hoveredMemoryID: UUID?
    @State private var permanentlyLost: Set<UUID> = []
    @State private var globalDecay: Double = 0
    @State private var timer: Timer?
    
    let decayRate: Double = 0.002
    let brushRadius: Double = 120
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Base deteriorating photograph
                ZStack {
                    Color(red: 0.15, green: 0.12, blue: 0.10)
                        .ignoresSafeArea()
                    
                    // Aged paper texture
                    LinearGradient(
                        stops: [
                            .init(color: Color(red: 0.94, green: 0.89, blue: 0.82), location: 0),
                            .init(color: Color(red: 0.87, green: 0.81, blue: 0.73), location: 0.3),
                            .init(color: Color(red: 0.91, green: 0.86, blue: 0.78), location: 0.7),
                            .init(color: Color(red: 0.89, green: 0.84, blue: 0.76), location: 1)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    .opacity(0.9 - globalDecay * 0.3)
                    .blur(radius: globalDecay * 2)
                    
                    // Vignette
                    RadialGradient(
                        colors: [
                            Color.clear,
                            Color.black.opacity(0.1),
                            Color.black.opacity(0.3),
                            Color.black.opacity(0.6)
                        ],
                        center: .center,
                        startRadius: 200,
                        endRadius: 600
                    )
                    .blendMode(.multiply)
                    
                    // Age spots and stains
                    ForEach(0..<12) { i in
                        Circle()
                            .fill(Color(red: 0.6, green: 0.5, blue: 0.4))
                            .frame(width: Double.random(in: 20...80))
                            .opacity(Double.random(in: 0.05...0.15))
                            .blur(radius: Double.random(in: 5...15))
                            .position(
                                x: Double(i * 120 + Int.random(in: -50...50)),
                                y: Double((i % 4) * 200 + Int.random(in: -50...50))
                            )
                    }
                }
                
                // Memory fragments layer
                ForEach(memories.filter { !permanentlyLost.contains($0.id) }) { memory in
                    let distance = sqrt(pow(cursorPosition.x - memory.position.x, 2) + pow(cursorPosition.y - memory.position.y, 2))
                    let inRange = distance < brushRadius * brushPower
                    let timeSinceHover = Date().timeIntervalSince(memory.lastHovered)
                    let fadeEffect = min(timeSinceHover * 0.1, 1.0)
                    
                    Text(memory.text)
                        .font(.system(size: 14, weight: .light, design: .serif))
                        .foregroundColor(Color(red: 0.3, green: 0.25, blue: 0.2))
                        .opacity(inRange ? 0.9 : max(0, memory.opacity - fadeEffect))
                        .blur(radius: inRange ? 0 : min(10, fadeEffect * 5))
                        .scaleEffect(inRange && hoveredMemoryID == memory.id ? 1.05 : 1.0)
                        .saturation(inRange ? 1.0 : max(0, 1.0 - fadeEffect))
                        .position(memory.position)
                        .animation(.easeOut(duration: 0.3), value: inRange)
                        .onHover { hovering in
                            if hovering && inRange {
                                hoveredMemoryID = memory.id
                                if let index = memories.firstIndex(where: { $0.id == memory.id }) {
                                    memories[index].viewCount += 1
                                    memories[index].lastHovered = Date()
                                    memories[index].opacity = max(0.3, memories[index].opacity - 0.15)
                                    
                                    if memories[index].viewCount >= memory.maxViews {
                                        withAnimation(.easeOut(duration: 2.0)) {
                                            permanentlyLost.insert(memory.id)
                                        }
                                    }
                                    
                                    brushPower = max(0.2, brushPower - 0.05)
                                }
                            } else if !hovering && hoveredMemoryID == memory.id {
                                hoveredMemoryID = nil
                            }
                        }
                }
                
                // Cursor brush indicator
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color.white.opacity(0.1),
                                Color.white.opacity(0.05),
                                Color.clear
                            ],
                            center: .center,
                            startRadius: 0,
                            endRadius: CGFloat(brushRadius * brushPower)
                        )
                    )
                    .frame(width: CGFloat(brushRadius * brushPower * 2), height: CGFloat(brushRadius * brushPower * 2))
                    .position(cursorPosition)
                    .allowsHitTesting(false)
                    .blur(radius: 2)
                
                // Restoration particles
                ForEach(regions) { region in
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    Color.yellow.opacity(region.intensity * 0.3),
                                    Color.orange.opacity(region.intensity * 0.2),
                                    Color.clear
                                ],
                                center: .center,
                                startRadius: 0,
                                endRadius: CGFloat(region.radius)
                            )
                        )
                        .frame(width: CGFloat(region.radius * 2), height: CGFloat(region.radius * 2))
                        .position(region.center)
                        .blur(radius: 3)
                        .allowsHitTesting(false)
                }
            }
            .onContinuousHover { phase in
                switch phase {
                case .active(let location):
                    cursorPosition = location
                case .ended:
                    break
                }
            }
            .onAppear {
                timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
                    globalDecay = min(1.0, globalDecay + decayRate)
                    regions = regions.map { region in
                        var updatedRegion = region
                        return MemoryRegion(
                            center: updatedRegion.center,
                            radius: updatedRegion.radius * 0.95,
                            intensity: updatedRegion.intensity * 0.9
                        )
                    }.filter { $0.intensity > 0.01 }
                    
                    if brushPower < 1.0 {
                        brushPower = min(1.0, brushPower + 0.001)
                    }
                }
            }
            .onDisappear {
                timer?.invalidate()
            }
            .onTapGesture(count: 2) { location in
                let newRegion = MemoryRegion(
                    center: location,
                    radius: 150,
                    intensity: 1.0
                )
                regions.append(newRegion)
                brushPower = min(1.0, brushPower + 0.2)
                globalDecay = max(0, globalDecay - 0.1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
    }
}