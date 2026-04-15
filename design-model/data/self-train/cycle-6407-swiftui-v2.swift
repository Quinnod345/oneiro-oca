struct ContentView: View {
    @State private var memories: [Memory] = Memory.generateMemories()
    @State private var selectedMemory: UUID?
    @State private var hoveredMemory: UUID?
    @State private var tableRotation: Double = 0
    @State private var tearInventory = TearInventory()
    @State private var activeBids: [UUID: Bid] = [:]
    @State private var showBiddingDrawer = false
    @State private var isDragging = false
    @State private var dragOffset: CGFloat = 0
    
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
                
                // Central auction table
                ZStack {
                    // Table surface
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
                            isHovered: hoveredMemory == memory.id
                        )
                        .position(
                            x: geometry.size.width/2 + cos(radian) * tableRadius,
                            y: geometry.size.height/2 + sin(radian) * tableRadius
                        )
                        .blur(radius: selectedMemory != nil && selectedMemory != memory.id ? 3 : 0)
                        .scaleEffect(selectedMemory == memory.id ? 1.1 : 1)
                        .zIndex(selectedMemory == memory.id ? 1 : 0)
                        .onHover { hovering in
                            if !isDragging {
                                withAnimation(.easeOut(duration: 0.2)) {
                                    hoveredMemory = hovering ? memory.id : nil
                                }
                            }
                        }
                        .onTapGesture {
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                                if selectedMemory == memory.id {
                                    selectedMemory = nil
                                    showBiddingDrawer = false
                                } else {
                                    selectedMemory = memory.id
                                    showBiddingDrawer = true
                                }
                            }
                        }
                        .animation(.easeInOut(duration: 0.3), value: selectedMemory)
                    }
                }
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            isDragging = true
                            dragOffset = value.translation.width
                        }
                        .onEnded { value in
                            isDragging = false
                            withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                                tableRotation += Double(value.translation.width / 2)
                                dragOffset = 0
                            }
                        }
                )
                .rotation3DEffect(
                    .degrees(Double(dragOffset) / 10),
                    axis: (x: 0, y: 1, z: 0)
                )
                
                // UI Elements
                VStack {
                    HStack {
                        // Title
                        Text("Memory Auction")
                            .font(.custom("SF Pro Display", size: 32))
                            .fontWeight(.thin)
                            .foregroundColor(.white.opacity(0.9))
                            .padding()
                        
                        Spacer()
                        
                        // Tear inventory badges
                        HStack(spacing: 16) {
                            TearBadge(type: .joy, count: tearInventory.joyTears)
                            TearBadge(type: .sorrow, count: tearInventory.sorrowTears)
                            TearBadge(type: .nostalgia, count: tearInventory.nostalgiaTears)
                            TearBadge(type: .regret, count: tearInventory.regretTears)
                        }
                        .padding()
                    }
                    
                    Spacer()
                    
                    // Interaction hint
                    if selectedMemory == nil {
                        Text("Drag to rotate • Tap to inspect")
                            .font(.custom("SF Pro Display", size: 14))
                            .foregroundColor(.white.opacity(0.5))
                            .padding()
                    }
                }
                
                // Bidding drawer
                if showBiddingDrawer, let memoryId = selectedMemory,
                   let memory = memories.first(where: { $0.id == memoryId }) {
                    BiddingDrawer(
                        memory: memory,
                        tearInventory: $tearInventory,
                        activeBid: $activeBids[memoryId],
                        isShowing: $showBiddingDrawer,
                        onClose: {
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                                selectedMemory = nil
                                showBiddingDrawer = false
                            }
                        }
                    )
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}

struct MemoryCard: View {
    let memory: Memory
    let bid: Bid?
    let isSelected: Bool
    let isHovered: Bool
    
    var body: some View {
        VStack(spacing: 0) {
            // Memory visualization
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: memory.emotionGradient,
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    Image(systemName: memory.symbolName)
                        .font(.system(size: 40, weight: .thin))
                        .foregroundColor(.white.opacity(0.8))
                )
                .frame(width: 140, height: 200)
            
            // Memory details
            VStack(alignment: .leading, spacing: 4) {
                Text(memory.description)
                    .font(.custom("SF Pro Display", size: 16))
                    .fontWeight(.medium)
                    .lineLimit(2)
                
                Text("\(memory.year)")
                    .font(.custom("SF Pro Display", size: 14))
                    .foregroundColor(.secondary)
                
                if let bid = bid {
                    HStack(spacing: 4) {
                        Image(systemName: bid.tearType.iconName)
                            .font(.system(size: 12))
                        Text("\(bid.amount)")
                            .font(.custom("SF Pro Display", size: 14))
                            .fontWeight(.semibold)
                    }
                    .foregroundColor(bid.tearType.color)
                    .padding(.top, 4)
                }
            }
            .padding(12)
            .frame(width: 140, alignment: .leading)
            .background(Color.black.opacity(0.8))
        }
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(color: .black.opacity(isSelected ? 0.6 : 0.3), radius: isSelected ? 20 : 10)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(
                    isSelected ? Color.white.opacity(0.8) : Color.clear,
                    lineWidth: 2
                )
        )
    }
}

struct TearBadge: View {
    let type: TearType
    let count: Int
    
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: type.iconName)
                .font(.system(size: 18, weight: .medium))
            Text("\(count)")
                .font(.custom("SF Pro Display", size: 16))
                .fontWeight(.semibold)
        }
        .foregroundColor(type.color)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            Capsule()
                .fill(type.color.opacity(0.2))
                .overlay(
                    Capsule()
                        .strokeBorder(type.color.opacity(0.4), lineWidth: 1)
                )
        )
    }
}

struct BiddingDrawer: View {
    let memory: Memory
    @Binding var tearInventory: TearInventory
    @Binding var activeBid: Bid?
    @Binding var isShowing: Bool
    let onClose: () -> Void
    
    @State private var selectedTearType: TearType = .joy
    @State private var bidAmount: Int = 1
    
    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            
            VStack(spacing: 24) {
                // Handle
                Capsule()
                    .fill(Color.white.opacity(0.3))
                    .frame(width: 40, height: 4)
                    .padding(.top, 12)
                
                // Memory preview
                HStack(spacing: 16) {
                    Rectangle()
                        .fill(
                            LinearGradient(
                                colors: memory.emotionGradient,
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .overlay(
                            Image(systemName: memory.symbolName)
                                .font(.system(size: 30, weight: .thin))
                                .foregroundColor(.white.opacity(0.8))
                        )
                        .frame(width: 80, height: 80)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text(memory.description)
                            .font(.custom("SF Pro Display", size: 18))
                            .fontWeight(.semibold)
                        Text("\(memory.year)")
                            .font(.custom("SF Pro Display", size: 14))
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                    
                    Button(action: onClose) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 24))
                            .foregroundColor(.white.opacity(0.5))
                    }
                }
                .padding(.horizontal, 24)
                
                // Tear selection
                VStack(alignment: .leading, spacing: 12) {
                    Text("Select tear type")
                        .font(.custom("SF Pro Display", size: 16))
                        .foregroundColor(.secondary)
                    
                    HStack(spacing: 12) {
                        ForEach([TearType.joy, .sorrow, .nostalgia, .regret], id: \.self) { type in
                            TearTypeButton(
                                type: type,
                                isSelected: selectedTearType == type,
                                available: tearInventory.count(for: type)
                            ) {
                                selectedTearType = type
                                bidAmount = min(bidAmount, tearInventory.count(for: type))
                            }
                        }
                    }
                }
                .padding(.horizontal, 24)
                
                // Bid amount
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Bid amount")
                            .font(.custom("SF Pro Display", size: 16))
                            .foregroundColor(.secondary)
                        
                        Spacer()
                        
                        Text("\(bidAmount) / \(tearInventory.count(for: selectedTearType))")
                            .font(.custom("SF Pro Display", size: 14))
                            .foregroundColor(.white.opacity(0.7))
                    }
                    
                    HStack(spacing: 16) {
                        Button(action: { if bidAmount > 1 { bidAmount -= 1 } }) {
                            Image(systemName: "minus.circle.fill")
                                .font(.system(size: 32))
                                .foregroundColor(.white.opacity(bidAmount > 1 ? 0.7 : 0.3))
                        }
                        .disabled(bidAmount <= 1)
                        
                        Text("\(bidAmount)")
                            .font(.custom("SF Pro Display", size: 24))
                            .fontWeight(.medium)
                            .frame(width: 60)
                        
                        Button(action: {
                            if bidAmount < tearInventory.count(for: selectedTearType) {
                                bidAmount += 1
                            }
                        }) {
                            Image(systemName: "plus.circle.fill")
                                .font(.system(size: 32))
                                .foregroundColor(.white.opacity(bidAmount < tearInventory.count(for: selectedTearType) ? 0.7 : 0.3))
                        }
                        .disabled(bidAmount >= tearInventory.count(for: selectedTearType))
                    }
                    .frame(maxWidth: .infinity)
                }
                .padding(.horizontal, 24)
                
                // Place bid button
                Button(action: {
                    activeBid = Bid(tearType: selectedTearType, amount: bidAmount)
                    tearInventory.spend(type: selectedTearType, amount: bidAmount)
                    onClose()
                }) {
                    Text("Place Bid")
                        .font(.custom("SF Pro Display", size: 18))
                        .fontWeight(.semibold)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(selectedTearType.color)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding(.horizontal, 24)
                .disabled(tearInventory.count(for: selectedTearType) < bidAmount)
            }
            .padding(.bottom, 34)
            .background(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(Color(white: 0.1))
                    .overlay(
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.1), lineWidth: 1)
                    )
            )
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: isShowing)
    }
}

struct TearTypeButton: View {
    let type: TearType
    let isSelected: Bool
    let available: Int
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: type.iconName)
                    .font(.system(size: 24))
                Text("\(available)")
                    .font(.custom("SF Pro Display", size: 14))
                    .fontWeight(.medium)
            }
            .foregroundColor(isSelected ? .white : type.color)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(isSelected ? type.color : type.color.opacity(0.2))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(type.color.opacity(0.4), lineWidth: 1)
                    )
            )
        }
        .disabled(available == 0)
        .opacity(available == 0 ? 0.5 : 1)
    }
}

// Models
struct Memory: Identifiable {
    let id = UUID()
    let description: String
    let year: Int
    let emotionGradient: [Color]
    let symbolName: String
    let fragments: [String]
    let owner: String
    
    static func generateMemories() -> [Memory] {
        [
            Memory(
                description: "First day of school nervousness",
                year: 1998,
                emotionGradient: [Color.orange, Color.yellow],
                symbolName: "backpack",
                fragments: ["New shoes", "Lunch box", "Mom's wave goodbye"],
                owner: "Anonymous"
            ),
            Memory(
                description: "Summer afternoon by the lake",
                year: 2005,
                emotionGradient: [Color.blue, Color.cyan],
                symbolName: "drop.fill",
                fragments: ["Sunlight on water", "Laughter echoing", "Cold lemonade"],
                owner: "M. Chen"
            ),
            Memory(
                description: "Grandmother's last birthday",
                year: 2019,
                emotionGradient: [Color.purple, Color.pink],
                symbolName: "gift",
                fragments: ["Wrinkled hands", "Favorite song", "Vanilla cake"],
                owner: "Anonymous"
            ),
            Memory(
                description: "Moving away from childhood home",
                year: 2012,
                emotionGradient: [Color.indigo, Color.blue],
                symbolName: "house",
                fragments: ["Empty rooms", "Height marks on doorframe", "Key turning"],
                owner: "J. Smith"
            ),
            Memory(
                description: "Learning to ride without training wheels",
                year: 1995,
                emotionGradient: [Color.green, Color.yellow],
                symbolName: "bicycle",
                fragments: ["Wobbly balance", "Dad letting go", "Wind in hair"],
                owner: "Anonymous"
            ),
            Memory(
                description: "Night before the big interview",
                year: 2018,
                emotionGradient: [Color.red, Color.orange],
                symbolName: "briefcase",
                fragments: ["Pressed shirt", "Practice answers", "4 AM worry"],
                owner: "K. Patel"
            )
        ]
    }
}

struct Bid {
    let tearType: TearType
    let amount: Int
}

enum TearType: CaseIterable {
    case joy
    case sorrow
    case nostalgia
    case regret
    
    var color: Color {
        switch self {
        case .joy: return Color.yellow
        case .sorrow: return Color.blue
        case .nostalgia: return Color.purple
        case .regret: return Color.gray
        }
    }
    
    var iconName: String {
        switch self {
        case .joy: return "sun.max.fill"
        case .sorrow: return "cloud.rain.fill"
        case .nostalgia: return "clock.fill"
        case .regret: return "arrow.uturn.left"
        }
    }
}

struct TearInventory {
    var joyTears: Int = 8
    var sorrowTears: Int = 12
    var nostalgiaTears: Int = 15
    var regretTears: Int = 5
    
    func count(for type: TearType) -> Int {
        switch type {
        case .joy: return joyTears
        case .sorrow: return sorrowTears
        case .nostalgia: return nostalgiaTears
        case .regret: return regretTears
        }
    }
    
    mutating func spend(type: TearType, amount: Int) {
        switch type {
        case .joy: joyTears = max(0, joyTears - amount)
        case .sorrow: sorrowTears = max(0, sorrowTears - amount)
        case .nostalgia: nostalgiaTears = max(0, nostalgiaTears - amount)
        case .regret: regretTears = max(0, regretTears - amount)
        }
    }
}