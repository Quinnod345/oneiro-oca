struct ContentView: View {
    @State private var memories: [Memory] = Memory.generateMemories()
    @State private var selectedMemory: Memory?
    @State private var emotionWallet = EmotionWallet()
    @State private var draggedEmotion: EmotionCoin?
    @State private var dragLocation: CGPoint = .zero
    @State private var aiShadows: [AIShadow] = []
    @State private var memoryRotations: [UUID: Double] = [:]
    @State private var bidRipples: [BidRipple] = []
    @State private var hoveredFacet: (UUID, Int)?
    @State private var auctionTimer = Timer.publish(every: 3.7, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            // Deep void background with subtle grain
            Rectangle()
                .fill(Color.black)
                .overlay(
                    GeometryReader { geo in
                        ForEach(0..<300, id: \.self) { i in
                            Circle()
                                .fill(Color.white.opacity(Double.random(in: 0.002...0.008)))
                                .frame(width: 1)
                                .position(
                                    x: CGFloat.random(in: 0...geo.size.width),
                                    y: CGFloat.random(in: 0...geo.size.height)
                                )
                        }
                    }
                )
            
            HStack(spacing: 0) {
                // Memories grid
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 280))], spacing: 40) {
                        ForEach(memories) { memory in
                            MemorySculpture(
                                memory: memory,
                                rotation: memoryRotations[memory.id] ?? 0,
                                isSelected: selectedMemory?.id == memory.id,
                                hoveredFacet: hoveredFacet?.0 == memory.id ? hoveredFacet?.1 : nil
                            )
                            .onTapGesture {
                                withAnimation(.easeInOut(duration: 0.8)) {
                                    selectedMemory = memory
                                }
                            }
                            .onDrop(of: [.text], isTargeted: nil) { providers in
                                handleEmotionDrop(on: memory)
                                return true
                            }
                        }
                    }
                    .padding(40)
                }
                .frame(maxWidth: .infinity)
                
                // Right panel - Emotion wallet and selected memory details
                VStack(alignment: .leading, spacing: 30) {
                    Text("EMOTIONAL RESERVES")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(Color.gray.opacity(0.7))
                        .tracking(2)
                    
                    VStack(spacing: 20) {
                        ForEach(EmotionType.allCases, id: \.self) { emotion in
                            EmotionCoinView(
                                type: emotion,
                                count: emotionWallet.balance[emotion] ?? 0,
                                isDragging: draggedEmotion?.type == emotion
                            )
                            .onDrag {
                                draggedEmotion = EmotionCoin(type: emotion)
                                return NSItemProvider(object: emotion.rawValue as NSString)
                            }
                        }
                    }
                    
                    Divider()
                        .background(Color.gray.opacity(0.3))
                        .padding(.vertical, 10)
                    
                    if let selected = selectedMemory {
                        VStack(alignment: .leading, spacing: 16) {
                            Text("MEMORY #\(String(selected.id.uuidString.prefix(8)))")
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .foregroundColor(Color.gray.opacity(0.5))
                            
                            Text(selected.title)
                                .font(.system(size: 18, weight: .light))
                                .foregroundColor(Color.white.opacity(0.9))
                            
                            Text("Clarity: \(Int(selected.clarity * 100))%")
                                .font(.system(size: 12, weight: .regular, design: .monospaced))
                                .foregroundColor(Color.gray.opacity(0.7))
                            
                            HStack(spacing: 12) {
                                ForEach(selected.emotionalBids.sorted(by: { $0.key.rawValue < $1.key.rawValue }), id: \.key) { emotion, amount in
                                    HStack(spacing: 4) {
                                        Circle()
                                            .fill(emotion.color)
                                            .frame(width: 8, height: 8)
                                        Text("\(amount)")
                                            .font(.system(size: 11, design: .monospaced))
                                    }
                                    .foregroundColor(Color.gray.opacity(0.6))
                                }
                            }
                        }
                    }
                    
                    Spacer()
                    
                    Text("COMPETING ENTITIES: \(aiShadows.count)")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundColor(Color.gray.opacity(0.5))
                }
                .frame(width: 320)
                .padding(30)
                .background(Color.black.opacity(0.3))
            }
            
            // AI Shadows
            ForEach(aiShadows) { shadow in
                AIShadowView(shadow: shadow, memories: memories)
            }
            
            // Bid ripples
            ForEach(bidRipples) { ripple in
                BidRippleView(ripple: ripple)
                    .allowsHitTesting(false)
            }
        }
        .frame(width: 1440, height: 900)
        .onReceive(auctionTimer) { _ in
            spawnAIShadow()
        }
        .onAppear {
            // Initialize some AI shadows
            for _ in 0..<3 {
                spawnAIShadow()
            }
        }
    }
    
    func handleEmotionDrop(on memory: Memory) {
        guard let emotion = draggedEmotion else { return }
        
        if var wallet = emotionWallet.balance[emotion.type], wallet > 0 {
            wallet -= 1
            emotionWallet.balance[emotion.type] = wallet
            
            if let index = memories.firstIndex(where: { $0.id == memory.id }) {
                memories[index].emotionalBids[emotion.type, default: 0] += 1
                memories[index].clarity = min(1.0, memories[index].clarity + 0.1)
                
                // Create ripple effect
                let ripple = BidRipple(
                    memoryId: memory.id,
                    emotion: emotion.type,
                    position: CGPoint(x: 720, y: 450) // Center of screen
                )
                bidRipples.append(ripple)
                
                // Remove ripple after animation
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                    bidRipples.removeAll { $0.id == ripple.id }
                }
            }
        }
        
        draggedEmotion = nil
    }
    
    func spawnAIShadow() {
        let shadow = AIShadow()
        aiShadows.append(shadow)
        
        // AI makes a bid occasionally
        DispatchQueue.main.asyncAfter(deadline: .now() + Double.random(in: 2...5)) {
            if let randomMemory = memories.randomElement() {
                let ripple = BidRipple(
                    memoryId: randomMemory.id,
                    emotion: .regret,
                    position: shadow.position,
                    isAIBid: true
                )
                bidRipples.append(ripple)
                
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                    bidRipples.removeAll { $0.id == ripple.id }
                }
            }
        }
        
        // Remove shadow after some time
        DispatchQueue.main.asyncAfter(deadline: .now() + Double.random(in: 15...25)) {
            aiShadows.removeAll { $0.id == shadow.id }
        }
    }
}

struct Memory: Identifiable {
    let id = UUID()
    var title: String
    var fragments: [String]
    var clarity: Double = 0.3
    var emotionalBids: [EmotionType: Int] = [:]
    var layers: [MemoryLayer] = []
    
    static func generateMemories() -> [Memory] {
        [
            Memory(
                title: "Summer thunderstorm",
                fragments: ["petrichor rising", "your hand finding mine", "lightning counting"],
                layers: MemoryLayer.random(count: 5)
            ),
            Memory(
                title: "Last conversation",
                fragments: ["words unspoken", "the space between", "silence louder than"],
                layers: MemoryLayer.random(count: 5)
            ),
            Memory(
                title: "Kitchen at 3am",
                fragments: ["burnt coffee", "whispered confessions", "fluorescent honesty"],
                layers: MemoryLayer.random(count: 5)
            ),
            Memory(
                title: "Train platform goodbye",
                fragments: ["diesel fumes", "promises breaking", "diminishing figure"],
                layers: MemoryLayer.random(count: 5)
            ),
            Memory(
                title: "First apartment",
                fragments: ["empty echoes", "sunlight through blinds", "possibility infinite"],
                layers: MemoryLayer.random(count: 5)
            ),
            Memory(
                title: "Forgotten birthday",
                fragments: ["candles unlit", "phone silent", "celebration deferred"],
                layers: MemoryLayer.random(count: 5)
            )
        ]
    }
}

struct MemoryLayer: Identifiable {
    let id = UUID()
    var opacity: Double
    var rotation: Double
    var scale: Double
    
    static func random(count: Int) -> [MemoryLayer] {
        (0..<count).map { i in
            MemoryLayer(
                opacity: Double.random(in: 0.1...0.3),
                rotation: Double(i) * 15,
                scale: 1.0 - (Double(i) * 0.05)
            )
        }
    }
}

enum EmotionType: String, CaseIterable {
    case joy, regret, curiosity
    
    var color: Color {
        switch self {
        case .joy: return Color.yellow.opacity(0.8)
        case .regret: return Color.blue.opacity(0.7)
        case .curiosity: return Color.green.opacity(0.7)
        }
    }
}

struct EmotionCoin: Identifiable {
    let id = UUID()
    var type: EmotionType
}

struct EmotionWallet {
    var balance: [EmotionType: Int] = [
        .joy: 12,
        .regret: 8,
        .curiosity: 15
    ]
}

struct AIShadow: Identifiable {
    let id = UUID()
    var position: CGPoint = CGPoint(
        x: CGFloat.random(in: 100...1340),
        y: CGFloat.random(in: 100...800)
    )
    var targetMemoryId: UUID?
    var opacity: Double = 0
}

struct BidRipple: Identifiable {
    let id = UUID()
    var memoryId: UUID
    var emotion: EmotionType
    var position: CGPoint
    var isAIBid: Bool = false
}

struct MemorySculpture: View {
    let memory: Memory
    let rotation: Double
    let isSelected: Bool
    let hoveredFacet: Int?
    
    var body: some View {
        ZStack {
            ForEach(Array(memory.layers.enumerated()), id: \.element.id) { index, layer in
                RoundedRectangle(cornerRadius: 12)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(layer.opacity * memory.clarity),
                                Color.gray.opacity(layer.opacity * 0.5 * memory.clarity)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 240, height: 320)
                    .rotation3DEffect(
                        .degrees(rotation + layer.rotation),
                        axis: (x: 0.1, y: 1, z: 0.1)
                    )
                    .scaleEffect(layer.scale)
                    .overlay(
                        VStack {
                            if index == 0 {
                                Text(memory.fragments[min(index, memory.fragments.count - 1)])
                                    .font(.system(size: 14, weight: .light))
                                    .foregroundColor(Color.black.opacity(memory.clarity))
                                    .padding()
                                    .opacity(memory.clarity > 0.5 ? 1 : 0)
                            }
                        }
                    )
            }
            
            // Facets for dropping emotions
            ForEach(0..<6, id: \.self) { facet in
                Rectangle()
                    .fill(Color.clear)
                    .frame(width: 80, height: 100)
                    .offset(
                        x: cos(Double(facet) * .pi / 3) * 100,
                        y: sin(Double(facet) * .pi / 3) * 100
                    )
                    .overlay(
                        hoveredFacet == facet ?
                        Circle()
                            .stroke(Color.white.opacity(0.3), lineWidth: 2)
                            .frame(width: 60, height: 60) : nil
                    )
            }
        }
        .frame(width: 280, height: 360)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.black.opacity(0.2))
                .blur(radius: 20)
        )
        .scaleEffect(isSelected ? 1.05 : 1)
        .animation(.easeInOut(duration: 0.3), value: isSelected)
    }
}

struct EmotionCoinView: View {
    let type: EmotionType
    let count: Int
    let isDragging: Bool
    
    var body: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(type.color)
                    .frame(width: 40, height: 40)
                
                Circle()
                    .stroke(Color.white.opacity(0.2), lineWidth: 1)
                    .frame(width: 40, height: 40)
            }
            .scaleEffect(isDragging ? 0.8 : 1)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(type.rawValue.uppercased())
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.white.opacity(0.8))
                
                Text("\(count) available")
                    .font(.system(size: 10, weight: .regular))
                    .foregroundColor(Color.gray.opacity(0.6))
            }
            
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.white.opacity(0.05))
        )
    }
}

struct AIShadowView: View {
    let shadow: AIShadow
    let memories: [Memory]
    @State private var phase: CGFloat = 0
    
    var body: some View {
        ZStack {
            ForEach(0..<3) { i in
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color.black.opacity(0.3),
                                Color.clear
                            ],
                            center: .center,
                            startRadius: 10,
                            endRadius: 40 + CGFloat(i) * 20
                        )
                    )
                    .frame(width: 80 + CGFloat(i) * 40, height: 80 + CGFloat(i) * 40)
                    .blur(radius: 3)
                    .opacity(sin(phase + Double(i)) * 0.3 + 0.5)
            }
        }
        .position(shadow.position)
        .onAppear {
            withAnimation(.easeInOut(duration: 3).repeatForever(autoreverses: true)) {
                phase = .pi * 2
            }
        }
    }
}

struct BidRippleView: View {
    let ripple: BidRipple
    @State private var scale: CGFloat = 0.1
    @State private var opacity: Double = 0.8
    
    var body: some View {
        Circle()
            .stroke(
                ripple.isAIBid ? Color.purple.opacity(0.6) : ripple.emotion.color,
                lineWidth: ripple.isAIBid ? 3 : 2
            )
            .frame(width: 100, height: 100)
            .scaleEffect(scale)
            .opacity(opacity)
            .position(ripple.position)
            .onAppear {
                withAnimation(.easeOut(duration: 2)) {
                    scale = 4
                    opacity = 0
                }
            }
    }
}