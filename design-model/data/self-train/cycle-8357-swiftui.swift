struct ContentView: View {
    @State private var memories: [Memory] = [
        Memory(content: "First day of school, yellow raincoat", lastAccessed: Date().addingTimeInterval(-86400 * 30), clarity: 0.3, position: CGPoint(x: 200, y: 300), rotation: -5),
        Memory(content: "Mom's lullaby, moonlight through curtains", lastAccessed: Date().addingTimeInterval(-86400 * 90), clarity: 0.15, position: CGPoint(x: 500, y: 200), rotation: 8),
        Memory(content: "Dad teaching me to ride, scraped knees", lastAccessed: Date().addingTimeInterval(-86400 * 7), clarity: 0.7, position: CGPoint(x: 800, y: 400), rotation: -12),
        Memory(content: "Grandmother's kitchen, flour everywhere", lastAccessed: Date().addingTimeInterval(-86400 * 180), clarity: 0.05, position: CGPoint(x: 350, y: 500), rotation: 3),
        Memory(content: "Best friend's laugh, summer camp", lastAccessed: Date().addingTimeInterval(-86400 * 45), clarity: 0.25, position: CGPoint(x: 1100, y: 300), rotation: -8),
        Memory(content: "First heartbreak, rain on windows", lastAccessed: Date().addingTimeInterval(-86400 * 14), clarity: 0.6, position: CGPoint(x: 950, y: 550), rotation: 15)
    ]
    
    @State private var selectedMemory: UUID?
    @State private var draggedMemory: UUID?
    @State private var currentDrag: DragGesture.Value?
    @State private var dustParticles: [MemoryDust] = []
    @State private var ashParticles: [MemoryDust] = []
    @State private var sacrificeMode: Bool = false
    @State private var sourceMemory: UUID?
    @State private var targetMemory: UUID?
    @State private var transferAmount: Double = 0
    
    let decayTimer = Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()
    let particleTimer = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            // Dark gallery background
            LinearGradient(
                colors: [
                    Color(red: 0.08, green: 0.07, blue: 0.09),
                    Color(red: 0.03, green: 0.02, blue: 0.04)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            
            // Ash particles floating upward
            ForEach(ashParticles) { particle in
                Circle()
                    .fill(Color(red: 0.4, green: 0.4, blue: 0.4))
                    .frame(width: particle.size, height: particle.size)
                    .opacity(particle.opacity)
                    .position(particle.position)
                    .blur(radius: particle.size / 4)
            }
            
            // Memory polaroids
            ForEach(memories) { memory in
                PolaroidView(
                    memory: memory,
                    isSelected: selectedMemory == memory.id,
                    isSource: sourceMemory == memory.id,
                    isTarget: targetMemory == memory.id,
                    onTap: {
                        if sacrificeMode {
                            if sourceMemory == nil {
                                sourceMemory = memory.id
                            } else if sourceMemory != memory.id {
                                targetMemory = memory.id
                                performTransfer()
                            }
                        } else {
                            selectedMemory = selectedMemory == memory.id ? nil : memory.id
                        }
                    }
                )
                .scaleEffect(draggedMemory == memory.id ? 1.1 : 1.0)
                .animation(.spring(response: 0.3, dampingFraction: 0.7), value: draggedMemory)
            }
            
            // Memory dust particles
            ForEach(dustParticles) { particle in
                Circle()
                    .fill(Color(red: 0.9, green: 0.8, blue: 0.6))
                    .frame(width: particle.size, height: particle.size)
                    .opacity(particle.opacity)
                    .position(particle.position)
                    .blur(radius: 1)
            }
            
            // Control panel
            VStack {
                Spacer()
                ControlPanel(
                    selectedMemory: selectedMemory,
                    memories: memories,
                    sacrificeMode: $sacrificeMode,
                    onBid: { amount in
                        if let selected = selectedMemory,
                           let index = memories.firstIndex(where: { $0.id == selected }) {
                            memories[index].bidAmount += amount
                            memories[index].clarity = min(1.0, memories[index].clarity + 0.05)
                            memories[index].glowIntensity = min(1.0, memories[index].glowIntensity + 0.1)
                            memories[index].lastAccessed = Date()
                        }
                    },
                    onReset: {
                        sourceMemory = nil
                        targetMemory = nil
                        transferAmount = 0
                    }
                )
            }
        }
        .frame(width: 1440, height: 900)
        .onReceive(decayTimer) { _ in
            decayMemories()
        }
        .onReceive(particleTimer) { _ in
            updateParticles()
        }
    }
    
    func performTransfer() {
        guard let sourceId = sourceMemory,
              let targetId = targetMemory,
              let sourceIndex = memories.firstIndex(where: { $0.id == sourceId }),
              let targetIndex = memories.firstIndex(where: { $0.id == targetId }) else { return }
        
        let transferAmount = min(0.2, memories[sourceIndex].clarity * 0.5)
        
        // Create dust particles
        let sourcePos = memories[sourceIndex].position
        let targetPos = memories[targetIndex].position
        
        for _ in 0..<20 {
            let particle = MemoryDust(
                position: sourcePos,
                velocity: CGPoint(
                    x: (targetPos.x - sourcePos.x) / 50 + Double.random(in: -2...2),
                    y: (targetPos.y - sourcePos.y) / 50 + Double.random(in: -2...2)
                ),
                size: CGFloat.random(in: 2...6),
                opacity: 0.8
            )
            dustParticles.append(particle)
        }
        
        memories[sourceIndex].clarity = max(0, memories[sourceIndex].clarity - transferAmount)
        memories[targetIndex].clarity = min(1.0, memories[targetIndex].clarity + transferAmount)
        
        sourceMemory = nil
        targetMemory = nil
        sacrificeMode = false
    }
    
    func decayMemories() {
        for index in memories.indices {
            let daysSinceAccess = Date().timeIntervalSince(memories[index].lastAccessed) / 86400
            let decayRate = 0.001 * (1 + daysSinceAccess / 365)
            memories[index].clarity = max(0, memories[index].clarity - decayRate)
            memories[index].glowIntensity = max(0, memories[index].glowIntensity - 0.02)
            
            if memories[index].clarity < 0.1 && Double.random(in: 0...1) < 0.1 {
                let ash = MemoryDust(
                    position: memories[index].position,
                    velocity: CGPoint(x: Double.random(in: -1...1), y: -Double.random(in: 2...4)),
                    size: CGFloat.random(in: 3...8),
                    opacity: 0.3
                )
                ashParticles.append(ash)
            }
        }
    }
    
    func updateParticles() {
        dustParticles = dustParticles.compactMap { particle in
            var updated = particle
            updated.position.x += updated.velocity.x
            updated.position.y += updated.velocity.y
            updated.opacity = max(0, updated.opacity - 0.02)
            updated.lifetime += 1
            return updated.opacity > 0 && updated.lifetime < 100 ? updated : nil
        }
        
        ashParticles = ashParticles.compactMap { particle in
            var updated = particle
            updated.position.y += updated.velocity.y
            updated.position.x += sin(Double(updated.lifetime) * 0.1) * 2
            updated.opacity = max(0, updated.opacity - 0.005)
            updated.lifetime += 1
            return updated.opacity > 0 && updated.lifetime < 300 ? updated : nil
        }
    }
}

struct PolaroidView: View {
    let memory: Memory
    let isSelected: Bool
    let isSource: Bool
    let isTarget: Bool
    let onTap: () -> Void
    
    var body: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(Color(red: 0.15, green: 0.15, blue: 0.15))
                .opacity(1 - memory.clarity)
                .frame(width: 180, height: 180)
                .overlay(
                    Text(memory.content)
                        .font(.system(size: 14))
                        .foregroundColor(Color.white.opacity(memory.clarity))
                        .padding()
                        .multilineTextAlignment(.center)
                )
            
            Rectangle()
                .fill(Color(red: 0.95, green: 0.95, blue: 0.9))
                .frame(width: 180, height: 40)
                .overlay(
                    Text("Clarity: \(Int(memory.clarity * 100))%")
                        .font(.system(size: 10))
                        .foregroundColor(Color.black.opacity(0.6))
                )
        }
        .background(Color.white)
        .rotationEffect(.degrees(memory.rotation))
        .shadow(color: Color.black.opacity(0.3), radius: 8, x: 2, y: 2)
        .overlay(
            RoundedRectangle(cornerRadius: 2)
                .stroke(isSource ? Color.orange : (isTarget ? Color.green : Color.clear), lineWidth: 3)
        )
        .scaleEffect(isSelected ? 1.05 : 1.0)
        .position(memory.position)
        .onTapGesture {
            onTap()
        }
        .animation(.easeInOut(duration: 0.2), value: isSelected)
    }
}

struct ControlPanel: View {
    let selectedMemory: UUID?
    let memories: [Memory]
    @Binding var sacrificeMode: Bool
    let onBid: (Double) -> Void
    let onReset: () -> Void
    
    var selectedMemoryData: Memory? {
        memories.first { $0.id == selectedMemory }
    }
    
    var body: some View {
        VStack(spacing: 15) {
            if let memory = selectedMemoryData {
                Text(memory.content)
                    .font(.title3)
                    .foregroundColor(.white)
                
                HStack(spacing: 20) {
                    Button("Small Bid (+5%)") {
                        onBid(0.05)
                    }
                    .buttonStyle(BidButtonStyle())
                    
                    Button("Large Bid (+15%)") {
                        onBid(0.15)
                    }
                    .buttonStyle(BidButtonStyle())
                }
            }
            
            Toggle("Sacrifice Mode", isOn: $sacrificeMode)
                .toggleStyle(SwitchToggleStyle(tint: Color.orange))
                .foregroundColor(.white)
                .frame(width: 200)
                .onChange(of: sacrificeMode) { _ in
                    onReset()
                }
            
            if sacrificeMode {
                Text("Select source memory, then target memory")
                    .font(.caption)
                    .foregroundColor(Color.gray)
            }
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 15)
                .fill(Color.black.opacity(0.7))
                .background(
                    RoundedRectangle(cornerRadius: 15)
                        .stroke(Color.white.opacity(0.2), lineWidth: 1)
                )
        )
        .padding(30)
    }
}

struct BidButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(configuration.isPressed ? Color.blue.opacity(0.6) : Color.blue)
            )
            .foregroundColor(.white)
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
    }
}