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
            // Clean gradient background
            RadialGradient(
                colors: [Color(red: 0.02, green: 0.02, blue: 0.03), Color.black],
                center: .center,
                startRadius: 100,
                endRadius: 800
            )
            .ignoresSafeArea()
            
            HStack(spacing: 0) {
                // Memories grid with proper spacing
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 240, maximum: 240))], spacing: 60) {
                        ForEach(memories) { memory in
                            MemorySculpture(
                                memory: memory,
                                rotation: memoryRotations[memory.id] ?? 0,
                                isSelected: selectedMemory?.id == memory.id,
                                hoveredFacet: hoveredFacet?.0 == memory.id ? hoveredFacet?.1 : nil
                            )
                            .frame(width: 240, height: 280)
                            .background(
                                RoundedRectangle(cornerRadius: 20)
                                    .fill(Color.white.opacity(selectedMemory?.id == memory.id ? 0.08 : 0.03))
                                    .blur(radius: 20)
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
                    .padding(80)
                }
                .frame(maxWidth: .infinity)
                
                // Right panel with clear visual zones
                VStack(alignment: .leading, spacing: 40) {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Emotional Reserves")
                            .font(.system(size: 24, weight: .semibold, design: .default))
                            .foregroundColor(.white)
                        
                        Text("DRAG TO BID")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(Color.gray.opacity(0.5))
                            .tracking(1.5)
                    }
                    
                    VStack(spacing: 24) {
                        ForEach(EmotionType.allCases, id: \.self) { emotion in
                            EmotionCoinView(
                                type: emotion,
                                count: emotionWallet.balance[emotion] ?? 0,
                                isDragging: draggedEmotion?.type == emotion
                            )
                            .frame(height: 60)
                            .background(
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(Color.white.opacity(0.05))
                            )
                            .onDrag {
                                draggedEmotion = EmotionCoin(type: emotion)
                                return NSItemProvider(object: emotion.rawValue as NSString)
                            }
                        }
                    }
                    .padding(.vertical, 20)
                    
                    if let selected = selectedMemory {
                        VStack(alignment: .leading, spacing: 20) {
                            Rectangle()
                                .fill(Color.gray.opacity(0.2))
                                .frame(height: 1)
                                .padding(.vertical, 20)
                            
                            VStack(alignment: .leading, spacing: 24) {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("Selected Memory")
                                        .font(.system(size: 14, weight: .medium))
                                        .foregroundColor(Color.gray.opacity(0.6))
                                    
                                    Text(selected.title)
                                        .font(.system(size: 28, weight: .light, design: .default))
                                        .foregroundColor(.white)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                
                                HStack(spacing: 40) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("CLARITY")
                                            .font(.system(size: 11, weight: .medium))
                                            .foregroundColor(Color.gray.opacity(0.5))
                                        Text("\(Int(selected.clarity * 100))%")
                                            .font(.system(size: 24, weight: .regular, design: .default))
                                            .foregroundColor(.white)
                                    }
                                    
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("ID")
                                            .font(.system(size: 11, weight: .medium))
                                            .foregroundColor(Color.gray.opacity(0.5))
                                        Text("#\(String(selected.id.uuidString.prefix(8)))")
                                            .font(.system(size: 16, weight: .regular, design: .monospaced))
                                            .foregroundColor(Color.gray.opacity(0.8))
                                    }
                                }
                                
                                VStack(alignment: .leading, spacing: 12) {
                                    Text("CURRENT BIDS")
                                        .font(.system(size: 11, weight: .medium))
                                        .foregroundColor(Color.gray.opacity(0.5))
                                    
                                    HStack(spacing: 16) {
                                        ForEach(selected.emotionalBids.sorted(by: { $0.key.rawValue < $1.key.rawValue }), id: \.key) { emotion, amount in
                                            HStack(spacing: 8) {
                                                Circle()
                                                    .fill(emotion.color)
                                                    .frame(width: 12, height: 12)
                                                Text("\(amount)")
                                                    .font(.system(size: 16, weight: .medium, design: .default))
                                                    .foregroundColor(.white)
                                            }
                                            .padding(.horizontal, 16)
                                            .padding(.vertical, 8)
                                            .background(
                                                Capsule()
                                                    .fill(Color.white.opacity(0.08))
                                            )
                                        }
                                    }
                                }
                            }
                            .padding(32)
                            .background(
                                RoundedRectangle(cornerRadius: 16)
                                    .fill(Color.white.opacity(0.03))
                            )
                        }
                    }
                    
                    Spacer()
                }
                .frame(width: 380)
                .padding(.vertical, 60)
                .padding(.horizontal, 40)
                .background(Color.black.opacity(0.3))
            }
            
            // AI Shadows with subtle presence
            ForEach(aiShadows) { shadow in
                AIShadowView(shadow: shadow)
            }
            
            // Clean bid ripples
            ForEach(bidRipples) { ripple in
                BidRippleView(ripple: ripple)
            }
        }
        .onReceive(auctionTimer) { _ in
            processAIBids()
            rotateMemories()
        }
    }
    
    func handleEmotionDrop(on memory: Memory) {
        guard let emotion = draggedEmotion,
              let balance = emotionWallet.balance[emotion.type],
              balance > 0 else { return }
        
        withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
            emotionWallet.balance[emotion.type]? -= 1
            
            if let existingBid = memories.firstIndex(where: { $0.id == memory.id }) {
                memories[existingBid].emotionalBids[emotion.type, default: 0] += 1
                
                let ripple = BidRipple(
                    position: CGPoint(x: 400, y: 300),
                    emotion: emotion.type
                )
                bidRipples.append(ripple)
                
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                    bidRipples.removeAll { $0.id == ripple.id }
                }
            }
        }
        
        draggedEmotion = nil
    }
    
    func processAIBids() {
        let shadow = AIShadow()
        aiShadows.append(shadow)
        
        if let randomMemory = memories.randomElement(),
           let randomEmotion = EmotionType.allCases.randomElement() {
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                withAnimation(.easeInOut(duration: 0.8)) {
                    if let index = memories.firstIndex(where: { $0.id == randomMemory.id }) {
                        memories[index].emotionalBids[randomEmotion, default: 0] += Int.random(in: 1...3)
                    }
                }
            }
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            aiShadows.removeAll { $0.id == shadow.id }
        }
    }
    
    func rotateMemories() {
        withAnimation(.easeInOut(duration: 2)) {
            for memory in memories {
                memoryRotations[memory.id] = Double.random(in: -10...10)
            }
        }
    }
}

struct Memory: Identifiable {
    let id = UUID()
    let title: String
    let clarity: Double
    var emotionalBids: [EmotionType: Int] = [:]
    let facets: [MemoryFacet]
    
    static func generateMemories() -> [Memory] {
        [
            Memory(title: "First Day of School", clarity: 0.75, facets: MemoryFacet.random()),
            Memory(title: "Grandmother's Kitchen", clarity: 0.92, facets: MemoryFacet.random()),
            Memory(title: "Lost in the Mall", clarity: 0.43, facets: MemoryFacet.random()),
            Memory(title: "Summer by the Lake", clarity: 0.88, facets: MemoryFacet.random()),
            Memory(title: "Moving Away", clarity: 0.67, facets: MemoryFacet.random()),
            Memory(title: "Birthday Surprise", clarity: 0.95, facets: MemoryFacet.random())
        ]
    }
}

struct MemoryFacet: Identifiable {
    let id = UUID()
    let opacity: Double
    let size: CGFloat
    
    static func random() -> [MemoryFacet] {
        (0..<6).map { _ in
            MemoryFacet(
                opacity: Double.random(in: 0.3...0.8),
                size: CGFloat.random(in: 40...80)
            )
        }
    }
}

enum EmotionType: String, CaseIterable {
    case joy, sadness, fear, anger, nostalgia
    
    var color: Color {
        switch self {
        case .joy: return Color(red: 1.0, green: 0.8, blue: 0.2)
        case .sadness: return Color(red: 0.3, green: 0.5, blue: 0.9)
        case .fear: return Color(red: 0.5, green: 0.2, blue: 0.5)
        case .anger: return Color(red: 0.9, green: 0.2, blue: 0.2)
        case .nostalgia: return Color(red: 0.7, green: 0.5, blue: 0.8)
        }
    }
}

struct EmotionCoin: Identifiable {
    let id = UUID()
    let type: EmotionType
}

struct EmotionWallet {
    var balance: [EmotionType: Int] = [
        .joy: 12,
        .sadness: 8,
        .fear: 6,
        .anger: 4,
        .nostalgia: 10
    ]
}

struct AIShadow: Identifiable {
    let id = UUID()
    let startPosition = CGPoint(x: CGFloat.random(in: 100...1200), y: CGFloat.random(in: 100...700))
}

struct BidRipple: Identifiable {
    let id = UUID()
    let position: CGPoint
    let emotion: EmotionType
}

struct MemorySculpture: View {
    let memory: Memory
    let rotation: Double
    let isSelected: Bool
    let hoveredFacet: Int?
    @State private var localRotation: Double = 0
    
    var body: some View {
        ZStack {
            ForEach(Array(memory.facets.enumerated()), id: \.element.id) { index, facet in
                RoundedRectangle(cornerRadius: 12)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(facet.opacity * 0.15),
                                Color.gray.opacity(facet.opacity * 0.1)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: facet.size, height: facet.size)
                    .rotationEffect(.degrees(Double(index) * 60 + rotation + localRotation))
                    .scaleEffect(hoveredFacet == index ? 1.1 : 1.0)
                    .blur(radius: isSelected ? 0 : 2)
            }
            
            VStack(spacing: 8) {
                Text(memory.title)
                    .font(.system(size: 16, weight: .medium, design: .default))
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
                
                Text("\(Int(memory.clarity * 100))% clear")
                    .font(.system(size: 12))
                    .foregroundColor(Color.gray.opacity(0.6))
            }
            .padding(20)
        }
        .frame(width: 240, height: 280)
        .onAppear {
            withAnimation(.linear(duration: 20).repeatForever(autoreverses: false)) {
                localRotation = 360
            }
        }
    }
}

struct EmotionCoinView: View {
    let type: EmotionType
    let count: Int
    let isDragging: Bool
    
    var body: some View {
        HStack(spacing: 16) {
            Circle()
                .fill(type.color)
                .frame(width: 40, height: 40)
                .overlay(
                    Circle()
                        .strokeBorder(Color.white.opacity(0.3), lineWidth: 1)
                )
                .scaleEffect(isDragging ? 0.8 : 1.0)
            
            VStack(alignment: .leading, spacing: 4) {
                Text(type.rawValue.capitalized)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(.white)
                Text("\(count) available")
                    .font(.system(size: 12))
                    .foregroundColor(Color.gray.opacity(0.6))
            }
            
            Spacer()
        }
        .padding(.horizontal, 16)
        .opacity(isDragging ? 0.5 : 1.0)
    }
}

struct AIShadowView: View {
    let shadow: AIShadow
    @State private var opacity: Double = 0
    @State private var position: CGPoint
    
    init(shadow: AIShadow) {
        self.shadow = shadow
        self._position = State(initialValue: shadow.startPosition)
    }
    
    var body: some View {
        Image(systemName: "figure.walk")
            .font(.system(size: 30))
            .foregroundColor(.white)
            .opacity(opacity * 0.15)
            .blur(radius: 4)
            .position(position)
            .onAppear {
                withAnimation(.easeInOut(duration: 3)) {
                    opacity = 0.5
                    position = CGPoint(
                        x: position.x + CGFloat.random(in: -200...200),
                        y: position.y + CGFloat.random(in: -100...100)
                    )
                }
            }
    }
}

struct BidRippleView: View {
    let ripple: BidRipple
    @State private var scale: CGFloat = 0
    @State private var opacity: Double = 0.8
    
    var body: some View {
        Circle()
            .stroke(ripple.emotion.color, lineWidth: 2)
            .frame(width: 100, height: 100)
            .scaleEffect(scale)
            .opacity(opacity)
            .position(ripple.position)
            .onAppear {
                withAnimation(.easeOut(duration: 2)) {
                    scale = 3
                    opacity = 0
                }
            }
    }
}