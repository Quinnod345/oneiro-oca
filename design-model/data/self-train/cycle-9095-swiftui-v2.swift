struct ContentView: View {
    @State private var memories: [MemoryOrb] = []
    @State private var particles: [LuminousParticle] = []
    @State private var hoveredMemory: UUID?
    @State private var activeExamination: UUID?
    @State private var vaultPosition: CGPoint = CGPoint(x: 720, y: 450)
    @State private var preservedMemories: [MemoryOrb] = []
    @State private var bidBalance: CGFloat = 100.0
    @State private var selectedMemory: UUID?
    @State private var showingBidSheet = false
    
    let memoryScenes = [
        "First day of school, nervous hands clutching a new backpack",
        "Grandmother's kitchen, flour dust dancing in afternoon light",
        "That summer road trip, windows down, singing off-key",
        "The argument that changed everything, words like broken glass",
        "Dancing in the rain after graduation, mascara running",
        "Last conversation with dad, hospital machines beeping",
        "Wedding day nerves, hands trembling with the rings",
        "Child's first steps, arms outstretched for balance"
    ]
    
    let updateTimer = Timer.publish(every: 0.016, on: .main, in: .common).autoconnect()
    let damageTimer = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            // Simplified gradient background
            LinearGradient(
                colors: [
                    Color(red: 0.08, green: 0.08, blue: 0.12),
                    Color(red: 0.02, green: 0.02, blue: 0.04)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            
            // Reduced particles tied to memory states
            ForEach(particles) { particle in
                Circle()
                    .fill(Color.white.opacity(0.3))
                    .frame(width: 2, height: 2)
                    .blur(radius: 0.5)
                    .opacity(particle.opacity)
                    .position(particle.position)
            }
            
            // Memory orbs with cleaner interaction
            ForEach(memories) { memory in
                MemoryOrbView(
                    memory: memory,
                    isHovered: hoveredMemory == memory.id,
                    isActive: activeExamination == memory.id,
                    isSelected: selectedMemory == memory.id
                )
                .position(memory.position)
                .onHover { hovering in
                    hoveredMemory = hovering ? memory.id : nil
                }
                .onTapGesture {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        selectedMemory = memory.id
                        showingBidSheet = true
                    }
                }
                .contextMenu {
                    Button("Examine Memory") {
                        activeExamination = memory.id
                    }
                    Button("Place Bid") {
                        selectedMemory = memory.id
                        showingBidSheet = true
                    }
                }
            }
            
            // Central vault
            VaultView(position: vaultPosition, preservedCount: preservedMemories.count)
            
            // UI overlay with clear hierarchy
            VStack {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("MEMORY VAULT")
                            .font(.system(size: 24, weight: .semibold))
                            .foregroundColor(.white)
                        
                        HStack(spacing: 16) {
                            Label("\(Int(bidBalance)) fragments", systemImage: "cube.fill")
                                .font(.system(size: 16, weight: .regular))
                                .foregroundColor(Color(red: 0.7, green: 0.7, blue: 0.8))
                            
                            Label("\(preservedMemories.count) preserved", systemImage: "lock.fill")
                                .font(.system(size: 16, weight: .regular))
                                .foregroundColor(Color(red: 0.4, green: 0.8, blue: 0.6))
                        }
                    }
                    .padding(24)
                    .background(Color.black.opacity(0.3))
                    .cornerRadius(16)
                    
                    Spacer()
                }
                .padding(32)
                
                Spacer()
                
                if let examiningId = activeExamination,
                   let memory = memories.first(where: { $0.id == examiningId }) {
                    MemoryDetailView(memory: memory, onClose: {
                        activeExamination = nil
                    })
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
        .sheet(isPresented: $showingBidSheet) {
            if let memoryId = selectedMemory,
               let memory = memories.first(where: { $0.id == memoryId }) {
                BidSheetView(
                    memory: memory,
                    balance: $bidBalance,
                    onBid: { amount in
                        if amount <= bidBalance {
                            bidBalance -= amount
                            preservedMemories.append(memory)
                            memories.removeAll { $0.id == memoryId }
                            generateParticlesForPreserved(at: memory.position)
                        }
                        showingBidSheet = false
                        selectedMemory = nil
                    },
                    onCancel: {
                        showingBidSheet = false
                        selectedMemory = nil
                    }
                )
            }
        }
        .onAppear {
            setupInitialState()
        }
        .onReceive(updateTimer) { _ in
            updateParticles()
            updateMemoryPositions()
        }
        .onReceive(damageTimer) { _ in
            damageMemories()
        }
    }
    
    func setupInitialState() {
        for i in 0..<6 {
            let angle = Double(i) * .pi * 2 / 6
            let radius = 200.0
            let x = 720 + cos(angle) * radius
            let y = 450 + sin(angle) * radius
            
            memories.append(MemoryOrb(
                position: CGPoint(x: x, y: y),
                description: memoryScenes[i % memoryScenes.count],
                initialIntegrity: 1.0
            ))
        }
        
        for _ in 0..<20 {
            particles.append(LuminousParticle(
                position: CGPoint(x: CGFloat.random(in: 0...1440), y: CGFloat.random(in: 0...900)),
                velocity: CGPoint(x: CGFloat.random(in: -0.5...0.5), y: CGFloat.random(in: -0.5...0.5)),
                hue: 0.6,
                opacity: CGFloat.random(in: 0.1...0.3)
            ))
        }
    }
    
    func updateParticles() {
        for i in particles.indices {
            particles[i].position.x += particles[i].velocity.x
            particles[i].position.y += particles[i].velocity.y
            
            if particles[i].position.x < 0 || particles[i].position.x > 1440 {
                particles[i].velocity.x *= -1
            }
            if particles[i].position.y < 0 || particles[i].position.y > 900 {
                particles[i].velocity.y *= -1
            }
            
            // Attract particles to active memory
            if let activeId = activeExamination,
               let memory = memories.first(where: { $0.id == activeId }) {
                let dx = memory.position.x - particles[i].position.x
                let dy = memory.position.y - particles[i].position.y
                let distance = sqrt(dx * dx + dy * dy)
                if distance > 50 {
                    particles[i].velocity.x += dx / distance * 0.05
                    particles[i].velocity.y += dy / distance * 0.05
                }
            }
        }
    }
    
    func updateMemoryPositions() {
        for i in memories.indices {
            let time = Date().timeIntervalSinceReferenceDate
            let offset = sin(time + Double(i)) * 5
            memories[i].floatOffset = CGFloat(offset)
        }
    }
    
    func damageMemories() {
        for i in memories.indices {
            if activeExamination != memories[i].id {
                memories[i].integrity -= 0.002
                if memories[i].integrity <= 0 {
                    memories.remove(at: i)
                    return
                }
            }
        }
    }
    
    func generateParticlesForPreserved(at position: CGPoint) {
        for _ in 0..<10 {
            let angle = CGFloat.random(in: 0...(2 * .pi))
            let speed = CGFloat.random(in: 2...5)
            particles.append(LuminousParticle(
                position: position,
                velocity: CGPoint(x: cos(angle) * speed, y: sin(angle) * speed),
                hue: 0.35,
                opacity: 0.8
            ))
        }
    }
}

struct MemoryOrb: Identifiable {
    let id = UUID()
    var position: CGPoint
    var description: String
    var integrity: CGFloat
    var floatOffset: CGFloat = 0
    let initialIntegrity: CGFloat
    
    init(position: CGPoint, description: String, initialIntegrity: CGFloat) {
        self.position = position
        self.description = description
        self.integrity = initialIntegrity
        self.initialIntegrity = initialIntegrity
    }
}

struct LuminousParticle: Identifiable {
    let id = UUID()
    var position: CGPoint
    var velocity: CGPoint
    var hue: Double
    var opacity: CGFloat
}

struct MemoryOrbView: View {
    let memory: MemoryOrb
    let isHovered: Bool
    let isActive: Bool
    let isSelected: Bool
    
    var body: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(hue: 0.6, saturation: 0.8, brightness: 0.9 * memory.integrity),
                            Color(hue: 0.65, saturation: 0.9, brightness: 0.4 * memory.integrity)
                        ],
                        center: .center,
                        startRadius: 5,
                        endRadius: 30
                    )
                )
                .frame(width: 60, height: 60)
                .blur(radius: isActive ? 3 : 1)
                .scaleEffect(isHovered ? 1.1 : (isSelected ? 1.2 : 1.0))
                .animation(.easeInOut(duration: 0.2), value: isHovered)
                .animation(.easeInOut(duration: 0.2), value: isSelected)
            
            Circle()
                .stroke(
                    Color.white.opacity(isActive ? 0.8 : (isHovered ? 0.4 : 0.1)),
                    lineWidth: isActive ? 3 : 2
                )
                .frame(width: 65, height: 65)
                .animation(.easeInOut(duration: 0.2), value: isActive)
        }
        .offset(y: memory.floatOffset)
    }
}

struct VaultView: View {
    let position: CGPoint
    let preservedCount: Int
    
    var body: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(red: 0.1, green: 0.1, blue: 0.2),
                            Color(red: 0.05, green: 0.05, blue: 0.1)
                        ],
                        center: .center,
                        startRadius: 10,
                        endRadius: 80
                    )
                )
                .frame(width: 160, height: 160)
            
            Circle()
                .stroke(Color(red: 0.3, green: 0.3, blue: 0.5), lineWidth: 2)
                .frame(width: 165, height: 165)
            
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 48))
                .foregroundColor(Color(red: 0.4, green: 0.4, blue: 0.6))
            
            if preservedCount > 0 {
                Text("\(preservedCount)")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(8)
                    .background(Circle().fill(Color(red: 0.4, green: 0.8, blue: 0.6)))
                    .offset(x: 50, y: -50)
            }
        }
        .position(position)
    }
}

struct MemoryDetailView: View {
    let memory: MemoryOrb
    let onClose: () -> Void
    
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Memory Fragment")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(.white)
                
                Spacer()
                
                Button(action: onClose) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 24))
                        .foregroundColor(Color(red: 0.5, green: 0.5, blue: 0.6))
                }
                .buttonStyle(PlainButtonStyle())
            }
            
            Text(memory.description)
                .font(.system(size: 16))
                .foregroundColor(Color(red: 0.8, green: 0.8, blue: 0.9))
                .lineSpacing(4)
            
            HStack {
                Label("Integrity: \(Int(memory.integrity * 100))%", systemImage: "heart.fill")
                    .font(.system(size: 14))
                    .foregroundColor(Color(hue: 0.0, saturation: 0.8, brightness: memory.integrity))
                
                Spacer()
            }
        }
        .padding(24)
        .frame(maxWidth: 400)
        .background(Color.black.opacity(0.8))
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.white.opacity(0.2), lineWidth: 1)
        )
        .padding(32)
    }
}

struct BidSheetView: View {
    let memory: MemoryOrb
    @Binding var balance: CGFloat
    let onBid: (CGFloat) -> Void
    let onCancel: () -> Void
    
    @State private var bidAmount: String = "10"
    @FocusState private var isFocused: Bool
    
    var body: some View {
        VStack(spacing: 24) {
            Text("Place Your Bid")
                .font(.system(size: 24, weight: .semibold))
                .foregroundColor(.white)
            
            Text(memory.description)
                .font(.system(size: 16))
                .foregroundColor(Color(red: 0.7, green: 0.7, blue: 0.8))
                .multilineTextAlignment(.center)
                .lineSpacing(4)
                .padding(.horizontal)
            
            VStack(spacing: 12) {
                TextField("Amount", text: $bidAmount)
                    .textFieldStyle(PlainTextFieldStyle())
                    .font(.system(size: 32, weight: .regular))
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
                    .focused($isFocused)
                    .padding()
                    .background(Color.white.opacity(0.1))
                    .cornerRadius(12)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.white.opacity(0.3), lineWidth: 1)
                    )
                
                Text("Available: \(Int(balance)) fragments")
                    .font(.system(size: 14))
                    .foregroundColor(Color(red: 0.6, green: 0.6, blue: 0.7))
            }
            
            HStack(spacing: 16) {
                Button("Cancel") {
                    onCancel()
                }
                .buttonStyle(SecondaryButtonStyle())
                
                Button("Place Bid") {
                    if let amount = Double(bidAmount) {
                        onBid(CGFloat(amount))
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(Double(bidAmount) ?? 0 > Double(balance))
            }
        }
        .padding(32)
        .frame(width: 400)
        .background(Color(red: 0.08, green: 0.08, blue: 0.12))
        .cornerRadius(20)
        .onAppear {
            isFocused = true
        }
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundColor(.white)
            .padding(.horizontal, 24)
            .padding(.vertical, 12)
            .background(Color(red: 0.3, green: 0.6, blue: 0.9))
            .cornerRadius(8)
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .regular))
            .foregroundColor(Color(red: 0.7, green: 0.7, blue: 0.8))
            .padding(.horizontal, 24)
            .padding(.vertical, 12)
            .background(Color.white.opacity(0.1))
            .cornerRadius(8)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.white.opacity(0.2), lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
    }
}