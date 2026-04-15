struct ContentView: View {
    @State private var memories: [Memory] = Memory.generateMemories()
    @State private var selectedMemory: UUID?
    @State private var hoveredMemory: UUID?
    @State private var tableRotation: Double = 0
    @State private var tearInventory = TearInventory()
    @State private var activeBids: [UUID: Bid] = [:]
    @State private var mouseLocation: CGPoint = .zero
    
    let tableRadius: CGFloat = 280
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Darkened room atmosphere
                RadialGradient(
                    colors: [
                        Color(red: 0.05, green: 0.04, blue: 0.06),
                        Color(red: 0.02, green: 0.01, blue: 0.03)
                    ],
                    center: .center,
                    startRadius: 100,
                    endRadius: 600
                )
                .ignoresSafeArea()
                
                // Ambient dust particles
                ForEach(0..<30) { i in
                    Circle()
                        .fill(Color.white.opacity(0.03))
                        .frame(width: CGFloat.random(in: 1...3))
                        .position(
                            x: geometry.size.width * CGFloat.random(in: 0...1),
                            y: geometry.size.height * CGFloat.random(in: 0...1)
                        )
                        .animation(
                            .linear(duration: Double.random(in: 20...40))
                            .repeatForever(autoreverses: false),
                            value: tableRotation
                        )
                        .offset(y: tableRotation.truncatingRemainder(dividingBy: 100) * 2)
                }
                
                // Central auction table
                ZStack {
                    // Table surface with wood grain
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    Color(red: 0.18, green: 0.12, blue: 0.09),
                                    Color(red: 0.12, green: 0.08, blue: 0.06)
                                ],
                                center: .center,
                                startRadius: 50,
                                endRadius: tableRadius
                            )
                        )
                        .frame(width: tableRadius * 2.2, height: tableRadius * 2.2)
                        .overlay(
                            Circle()
                                .strokeBorder(
                                    LinearGradient(
                                        colors: [
                                            Color(red: 0.25, green: 0.18, blue: 0.14),
                                            Color(red: 0.15, green: 0.10, blue: 0.08)
                                        ],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    ),
                                    lineWidth: 3
                                )
                        )
                        .shadow(color: .black.opacity(0.8), radius: 30, y: 10)
                    
                    // Memory cards arranged in circle
                    ForEach(memories) { memory in
                        let index = memories.firstIndex(where: { $0.id == memory.id }) ?? 0
                        let angle = (Double(index) / Double(memories.count)) * 360 + tableRotation
                        let radian = angle * .pi / 180
                        
                        MemoryCard(
                            memory: memory,
                            bid: activeBids[memory.id],
                            isSelected: selectedMemory == memory.id,
                            isHovered: hoveredMemory == memory.id,
                            revealAmount: calculateRevealAmount(for: memory.id)
                        )
                        .position(
                            x: geometry.size.width/2 + cos(radian) * tableRadius,
                            y: geometry.size.height/2 + sin(radian) * tableRadius
                        )
                        .rotation3DEffect(
                            .degrees(hoveredMemory == memory.id ? 0 : -30),
                            axis: (x: 1, y: 0, z: 0)
                        )
                        .onHover { hovering in
                            withAnimation(.easeOut(duration: 0.2)) {
                                hoveredMemory = hovering ? memory.id : nil
                            }
                        }
                        .onTapGesture {
                            withAnimation(.easeOut(duration: 0.3)) {
                                selectedMemory = selectedMemory == memory.id ? nil : memory.id
                            }
                        }
                    }
                }
                .onAppear {
                    withAnimation(.linear(duration: 180).repeatForever(autoreverses: false)) {
                        tableRotation = 360
                    }
                }
                
                // Tear inventory at bottom
                VStack {
                    Spacer()
                    TearInventoryView(inventory: tearInventory)
                        .padding(.bottom, 40)
                }
                
                // Selected memory detail
                if let selected = selectedMemory,
                   let memory = memories.first(where: { $0.id == selected }) {
                    MemoryDetailView(
                        memory: memory,
                        bid: activeBids[selected],
                        tearInventory: $tearInventory,
                        onBid: { tear in
                            placeBid(on: selected, with: tear)
                        },
                        onClose: {
                            withAnimation {
                                selectedMemory = nil
                            }
                        }
                    )
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .onContinuousHover { phase in
                switch phase {
                case .active(let location):
                    mouseLocation = location
                default:
                    break
                }
            }
        }
        .frame(width: 1440, height: 900)
    }
    
    func calculateRevealAmount(for memoryId: UUID) -> CGFloat {
        guard let bid = activeBids[memoryId] else { return 0 }
        let totalValue = bid.tears.reduce(0) { $0 + $1.value.rawValue }
        return min(CGFloat(totalValue) / 100, 1.0)
    }
    
    func placeBid(on memoryId: UUID, with tear: TearType) {
        guard tearInventory.tears[tear]! > 0 else { return }
        
        withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
            tearInventory.tears[tear]! -= 1
            
            if var existingBid = activeBids[memoryId] {
                existingBid.tears.append(Tear(type: tear))
                activeBids[memoryId] = existingBid
            } else {
                activeBids[memoryId] = Bid(tears: [Tear(type: tear)])
            }
        }
    }
}

struct Memory: Identifiable {
    let id = UUID()
    let imageData: [CGFloat]
    let hiddenLayer: String
    let shadowNarrative: String
    
    static func generateMemories() -> [Memory] {
        [
            Memory(
                imageData: [0.8, 0.2, 0.5, 0.9, 0.1, 0.7, 0.3, 0.6],
                hiddenLayer: "The last birthday before everything changed",
                shadowNarrative: "Candles still burning in forgotten rooms"
            ),
            Memory(
                imageData: [0.3, 0.9, 0.1, 0.7, 0.5, 0.2, 0.8, 0.4],
                hiddenLayer: "Summer rain on the old porch",
                shadowNarrative: "Thunder echoes in empty hearts"
            ),
            Memory(
                imageData: [0.6, 0.4, 0.9, 0.2, 0.7, 0.1, 0.5, 0.8],
                hiddenLayer: "Your mother's recipe, handwritten",
                shadowNarrative: "Ingredients for a life unlived"
            ),
            Memory(
                imageData: [0.2, 0.7, 0.3, 0.8, 0.1, 0.9, 0.4, 0.6],
                hiddenLayer: "First day in the new house",
                shadowNarrative: "Walls that learned to keep secrets"
            ),
            Memory(
                imageData: [0.9, 0.1, 0.6, 0.3, 0.8, 0.4, 0.2, 0.7],
                hiddenLayer: "Dancing at 3 AM, no music needed",
                shadowNarrative: "Rhythms lost to silence"
            ),
            Memory(
                imageData: [0.4, 0.8, 0.2, 0.6, 0.9, 0.3, 0.7, 0.1],
                hiddenLayer: "The dog's favorite hiding spot",
                shadowNarrative: "Loyalty buried beneath time"
            )
        ]
    }
}

struct MemoryCard: View {
    let memory: Memory
    let bid: Bid?
    let isSelected: Bool
    let isHovered: Bool
    let revealAmount: CGFloat
    
    var body: some View {
        ZStack {
            // Shadow cast by card
            if isHovered {
                Ellipse()
                    .fill(Color.black.opacity(0.3))
                    .frame(width: 140, height: 20)
                    .offset(y: 80)
                    .blur(radius: 10)
            }
            
            // Polaroid base
            RoundedRectangle(cornerRadius: 4)
                .fill(Color(red: 0.95, green: 0.94, blue: 0.92))
                .frame(width: 120, height: 140)
                .shadow(
                    color: .black.opacity(isHovered ? 0.3 : 0.2),
                    radius: isHovered ? 8 : 4,
                    y: isHovered ? 4 : 2
                )
            
            VStack(spacing: 8) {
                // Photo area with reveal effect
                ZStack {
                    // Base photo (obscured)
                    RoundedRectangle(cornerRadius: 2)
                        .fill(
                            LinearGradient(
                                colors: memory.imageData.enumerated().map { i, value in
                                    Color(
                                        red: 0.3 + value * 0.2,
                                        green: 0.25 + value * 0.15,
                                        blue: 0.2 + value * 0.1
                                    ).opacity(0.3)
                                },
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 100, height: 100)
                        .blur(radius: 8 * (1 - revealAmount))
                    
                    // Torn paper edges revealing image
                    ForEach(0..<4) { edge in
                        let rotation = Double(edge) * 90
                        let offset = 50 * (1 - revealAmount)
                        
                        Path { path in
                            path.move(to: CGPoint(x: 0, y: 0))
                            path.addLine(to: CGPoint(x: 100, y: 0))
                            path.addCurve(
                                to: CGPoint(x: 100, y: 100),
                                control1: CGPoint(x: 100 + CGFloat.random(in: -20...20), y: 30),
                                control2: CGPoint(x: 100 + CGFloat.random(in: -20...20), y: 70)
                            )
                            path.addLine(to: CGPoint(x: 0, y: 100))
                            path.closeSubpath()
                        }
                        .fill(Color.white.opacity(0.9 * revealAmount))
                        .frame(width: 100, height: 100)
                        .rotationEffect(.degrees(rotation))
                        .offset(
                            x: edge % 2 == 0 ? 0 : (edge == 1 ? offset : -offset),
                            y: edge % 2 == 1 ? 0 : (edge == 0 ? -offset : offset)
                        )
                    }
                    
                    // Hidden layer text (revealed progressively)
                    if revealAmount > 0.3 {
                        Text(memory.hiddenLayer)
                            .font(.custom("American Typewriter", size: 10))
                            .foregroundColor(Color(red: 0.2, green: 0.15, blue: 0.1))
                            .multilineTextAlignment(.center)
                            .lineLimit(3)
                            .padding(8)
                            .opacity(Double((revealAmount - 0.3) / 0.7))
                    }
                }
                
                // Tear pool at bottom
                if let bid = bid {
                    HStack(spacing: 2) {
                        ForEach(bid.tears.prefix(10)) { tear in
                            TearDrop(type: tear.type, size: .small)
                        }
                    }
                    .frame(height: 20)
                    .padding(.horizontal, 10)
                }
            }
            .padding(.top, 10)
        }
        .scaleEffect(isHovered ? 1.1 : (isSelected ? 1.05 : 1.0))
    }
}

struct MemoryDetailView: View {
    let memory: Memory
    let bid: Bid?
    @Binding var tearInventory: TearInventory
    let onBid: (TearType) -> Void
    let onClose: () -> Void
    
    var body: some View {
        ZStack {
            // Darkened overlay
            Color.black.opacity(0.7)
                .ignoresSafeArea()
                .onTapGesture(perform: onClose)
            
            VStack(spacing: 30) {
                // Large polaroid
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color(red: 0.95, green: 0.94, blue: 0.92))
                        .frame(width: 400, height: 460)
                        .shadow(color: .black.opacity(0.5), radius: 20, y: 10)
                    
                    VStack(spacing: 20) {
                        // Revealed photo
                        ZStack {
                            RoundedRectangle(cornerRadius: 4)
                                .fill(
                                    LinearGradient(
                                        colors: memory.imageData.map { value in
                                            Color(
                                                red: 0.7 + value * 0.3,
                                                green: 0.6 + value * 0.3,
                                                blue: 0.5 + value * 0.3
                                            )
                                        },
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                                .frame(width: 360, height: 360)
                            
                            Text(memory.hiddenLayer)
                                .font(.custom("American Typewriter", size: 24))
                                .foregroundColor(Color(red: 0.1, green: 0.08, blue: 0.06))
                                .multilineTextAlignment(.center)
                                .padding(20)
                        }
                        
                        // Shadow narrative
                        Text(memory.shadowNarrative)
                            .font(.custom("Baskerville-Italic", size: 16))
                            .foregroundColor(Color(red: 0.4, green: 0.35, blue: 0.3))
                    }
                    .padding(.top, 20)
                }
                
                // Bidding interface
                VStack(spacing: 20) {
                    Text("Offer your tears")
                        .font(.custom("Didot", size: 20))
                        .foregroundColor(Color(red: 0.8, green: 0.75, blue: 0.7))
                    
                    HStack(spacing: 30) {
                        ForEach(TearType.allCases) { tearType in
                            BidButton(
                                tearType: tearType,
                                count: tearInventory.tears[tearType]!,
                                onTap: {
                                    onBid(tearType)
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}

struct BidButton: View {
    let tearType: TearType
    let count: Int
    let onTap: () -> Void
    
    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 8) {
                TearDrop(type: tearType, size: .large)
                Text("\(count)")
                    .font(.custom("Avenir Next", size: 14))
                    .foregroundColor(Color.gray)
                Text(tearType.name)
                    .font(.custom("Avenir Next", size: 12))
                    .foregroundColor(Color(red: 0.6, green: 0.55, blue: 0.5))
            }
            .frame(width: 80, height: 100)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color(red: 0.1, green: 0.08, blue: 0.06).opacity(0.5))
                    .strokeBorder(tearType.color.opacity(0.3), lineWidth: 1)
            )
        }
        .buttonStyle(PlainButtonStyle())
        .disabled(count == 0)
        .opacity(count > 0 ? 1.0 : 0.4)
    }
}

struct TearInventoryView: View {
    let inventory: TearInventory
    
    var body: some View {
        HStack(spacing: 40) {
            ForEach(TearType.allCases) { tearType in
                HStack(spacing: 12) {
                    TearDrop(type: tearType, size: .medium)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(tearType.name)
                            .font(.custom("Avenir Next Medium", size: 14))
                            .foregroundColor(Color(red: 0.7, green: 0.65, blue: 0.6))
                        Text("\(inventory.tears[tearType]!) remaining")
                            .font(.custom("Avenir Next", size: 11))
                            .foregroundColor(Color(red: 0.5, green: 0.45, blue: 0.4))
                    }
                }
            }
        }
        .padding(.horizontal, 40)
        .padding(.vertical, 20)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(red: 0.08, green: 0.06, blue: 0.05).opacity(0.8))
                .strokeBorder(Color(red: 0.2, green: 0.15, blue: 0.1), lineWidth: 1)
        )
    }
}

struct TearDrop: View {
    let type: TearType
    let size: Size
    
    enum Size {
        case small, medium, large
        
        var dimension: CGFloat {
            switch self {
            case .small: return 8
            case .medium: return 16
            case .large: return 24
            }
        }
    }
    
    var body: some View {
        ZStack {
            // Crystal tear shape
            Image(systemName: "drop.fill")
                .font(.system(size: size.dimension))
                .foregroundStyle(
                    LinearGradient(
                        colors: [
                            type.color,
                            type.color.opacity(0.6)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
            
            // Inner glow
            Image(systemName: "drop.fill")
                .font(.system(size: size.dimension * 0.6))
                .foregroundColor(.white.opacity(0.3))
                .blur(radius: 2)
        }
    }
}

enum TearType: Int, CaseIterable, Identifiable {
    case joy = 30
    case sorrow = 20
    case nostalgia = 25
    
    var id: Self { self }
    
    var name: String {
        switch self {
        case .joy: return "Joy"
        case .sorrow: return "Sorrow"
        case .nostalgia: return "Nostalgia"
        }
    }
    
    var color: Color {
        switch self {
        case .joy: return Color(red: 1.0, green: 0.84, blue: 0.4)
        case .sorrow: return Color(red: 0.4, green: 0.6, blue: 0.8)
        case .nostalgia: return Color(red: 0.8, green: 0.6, blue: 0.7)
        }
    }
}

struct TearInventory {
    var tears: [TearType: Int] = [
        .joy: 12,
        .sorrow: 8,
        .nostalgia: 15
    ]
}

struct Tear: Identifiable {
    let id = UUID()
    let type: TearType
    let timestamp = Date()
    
    var value: TearType { type }
}

struct Bid {
    var tears: [Tear] = []
    let timestamp = Date()
}