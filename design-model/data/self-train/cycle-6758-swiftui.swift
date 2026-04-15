struct ContentView: View {
    @State private var vaults: [EmotionalVault] = [
        EmotionalVault(personName: "Sarah", balance: -8500, memories: [
            Memory(type: .joy, intensity: 0.7, fragment: "That summer we drove to the coast"),
            Memory(type: .anger, intensity: 0.9, fragment: "The argument about moving away"),
            Memory(type: .regret, intensity: 0.8, fragment: "Never said goodbye properly")
        ]),
        EmotionalVault(personName: "Marcus", balance: -3200, memories: [
            Memory(type: .joy, intensity: 0.6, fragment: "Building that treehouse together"),
            Memory(type: .regret, intensity: 0.5, fragment: "Lost touch after college")
        ]),
        EmotionalVault(personName: "Elena", balance: -12000, memories: [
            Memory(type: .anger, intensity: 0.8, fragment: "The betrayal still stings"),
            Memory(type: .joy, intensity: 0.4, fragment: "Before everything changed"),
            Memory(type: .regret, intensity: 0.9, fragment: "Could have handled it better")
        ])
    ]
    
    @State private var selectedVault: UUID?
    @State private var hoveredVault: UUID?
    @State private var withdrawnMemories: [WithdrawnMemory] = []
    @State private var ledgerBalance: Double = 0
    @State private var dissolvingMemories: [DissolveAnimation] = []
    @State private var pulseIntensity: [UUID: Double] = [:]
    
    var body: some View {
        ZStack {
            // Liminal space background
            Canvas { context, size in
                let gradient = Gradient(colors: [
                    Color.black.opacity(0.95),
                    Color.blue.opacity(0.05),
                    Color.black.opacity(0.98)
                ])
                context.fill(
                    Path(CGRect(origin: .zero, size: size)),
                    with: .linearGradient(gradient, startPoint: .zero, endPoint: CGPoint(x: size.width, y: size.height))
                )
                
                // Ethereal grid lines
                context.opacity = 0.03
                for x in stride(from: 0, through: size.width, by: 80) {
                    context.stroke(
                        Path { path in
                            path.move(to: CGPoint(x: x, y: 0))
                            path.addLine(to: CGPoint(x: x, y: size.height))
                        },
                        with: .color(.white)
                    )
                }
                for y in stride(from: 0, through: size.height, by: 80) {
                    context.stroke(
                        Path { path in
                            path.move(to: CGPoint(x: 0, y: y))
                            path.addLine(to: CGPoint(x: size.width, y: y))
                        },
                        with: .color(.white)
                    )
                }
            }
            
            HStack(spacing: 0) {
                // Vault chamber
                VStack(spacing: 40) {
                    Text("EMOTIONAL VAULT 77B")
                        .font(.custom("Menlo", size: 11))
                        .foregroundColor(.gray.opacity(0.4))
                        .tracking(3)
                    
                    ScrollView {
                        VStack(spacing: 30) {
                            ForEach(vaults) { vault in
                                VaultBox(
                                    vault: vault,
                                    isSelected: selectedVault == vault.id,
                                    isHovered: hoveredVault == vault.id,
                                    pulseIntensity: pulseIntensity[vault.id] ?? 0
                                )
                                .onTapGesture {
                                    withAnimation(.easeOut(duration: 0.6)) {
                                        selectedVault = vault.id
                                        pulseIntensity[vault.id] = 1.0
                                    }
                                    withAnimation(.easeOut(duration: 1.5).delay(0.6)) {
                                        pulseIntensity[vault.id] = 0
                                    }
                                }
                                .onHover { hovering in
                                    hoveredVault = hovering ? vault.id : nil
                                }
                            }
                        }
                        .padding(.horizontal, 60)
                    }
                }
                .frame(width: 480)
                .background(Color.black.opacity(0.3))
                
                // Memory transaction space
                VStack {
                    if let selectedId = selectedVault,
                       let vault = vaults.first(where: { $0.id == selectedId }) {
                        
                        VStack(spacing: 50) {
                            // Vault name and balance
                            VStack(spacing: 12) {
                                Text(vault.personName.uppercased())
                                    .font(.custom("Helvetica Neue", size: 32))
                                    .fontWeight(.thin)
                                    .foregroundColor(.white.opacity(0.9))
                                    .tracking(4)
                                
                                Text("BALANCE: \(vault.balance < 0 ? "-" : "")$\(abs(vault.balance))")
                                    .font(.custom("Menlo", size: 14))
                                    .foregroundColor(vault.balance < 0 ? Color.red.opacity(0.7) : Color.blue.opacity(0.7))
                            }
                            
                            // Memory crystals
                            VStack(spacing: 25) {
                                ForEach(vault.memories) { memory in
                                    MemoryCrystal(
                                        memory: memory,
                                        onWithdraw: { withdrawMemory(memory, from: vault) }
                                    )
                                }
                            }
                            
                            Spacer()
                        }
                        .padding(.top, 80)
                        .transition(.opacity.combined(with: .scale(scale: 0.95)))
                    }
                }
                .frame(width: 480)
                
                // Forgiveness ledger
                VStack(spacing: 40) {
                    Text("FORGIVENESS LEDGER")
                        .font(.custom("Menlo", size: 11))
                        .foregroundColor(.gray.opacity(0.4))
                        .tracking(3)
                    
                    // Ledger balance display
                    Text("$\(Int(ledgerBalance))")
                        .font(.custom("Helvetica Neue", size: 48))
                        .fontWeight(.ultraLight)
                        .foregroundColor(.blue.opacity(0.8))
                        .contentTransition(.numericText())
                    
                    // Drop zone
                    ZStack {
                        RoundedRectangle(cornerRadius: 2)
                            .stroke(Color.blue.opacity(0.2), style: StrokeStyle(lineWidth: 1, dash: [5, 5]))
                            .frame(width: 300, height: 300)
                        
                        Text("RELEASE TO DISSOLVE")
                            .font(.custom("Menlo", size: 10))
                            .foregroundColor(.blue.opacity(0.3))
                            .tracking(2)
                        
                        // Particle effects
                        ForEach(dissolvingMemories) { dissolve in
                            ParticleEffect(dissolve: dissolve)
                        }
                    }
                    .onDrop(of: [.text], isTargeted: nil) { providers in
                        handleDrop(providers)
                        return true
                    }
                    
                    Spacer()
                }
                .frame(width: 480)
                .background(Color.black.opacity(0.2))
            }
            
            // Floating withdrawn memories
            ForEach(withdrawnMemories) { withdrawn in
                DraggableMemory(withdrawn: withdrawn) { id in
                    withdrawnMemories.removeAll { $0.id == id }
                }
            }
        }
        .frame(width: 1440, height: 900)
    }
    
    func withdrawMemory(_ memory: Memory, from vault: EmotionalVault) {
        let withdrawn = WithdrawnMemory(
            memory: memory,
            sourceVault: vault.id,
            position: CGPoint(x: 720, y: 450)
        )
        withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
            withdrawnMemories.append(withdrawn)
        }
    }
    
    func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        for withdrawn in withdrawnMemories {
            let dissolve = DissolveAnimation(
                position: CGPoint(x: 960, y: 450),
                color: withdrawn.memory.type.color
            )
            dissolvingMemories.append(dissolve)
            
            // Update vault balance
            if let index = vaults.firstIndex(where: { $0.id == withdrawn.sourceVault }) {
                withAnimation(.easeOut(duration: 1.0)) {
                    vaults[index].balance += 1000
                    ledgerBalance += 1000
                }
            }
            
            // Remove after animation
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                dissolvingMemories.removeAll { $0.id == dissolve.id }
            }
        }
        
        withdrawnMemories.removeAll()
        return true
    }
}

struct EmotionalVault: Identifiable {
    let id = UUID()
    let personName: String
    var balance: Int
    let memories: [Memory]
}

struct Memory: Identifiable {
    let id = UUID()
    let type: MemoryType
    let intensity: Double
    let fragment: String
}

enum MemoryType {
    case joy, anger, regret
    
    var color: Color {
        switch self {
        case .joy: return .yellow
        case .anger: return .red
        case .regret: return .blue
        }
    }
}

struct WithdrawnMemory: Identifiable {
    let id = UUID()
    let memory: Memory
    let sourceVault: UUID
    var position: CGPoint
}

struct DissolveAnimation: Identifiable {
    let id = UUID()
    let position: CGPoint
    let color: Color
}

struct VaultBox: View {
    let vault: EmotionalVault
    let isSelected: Bool
    let isHovered: Bool
    let pulseIntensity: Double
    
    var body: some View {
        ZStack {
            // Base box
            RoundedRectangle(cornerRadius: 2)
                .fill(Color.gray.opacity(0.05))
                .overlay(
                    RoundedRectangle(cornerRadius: 2)
                        .stroke(
                            Color.white.opacity(isSelected ? 0.3 : 0.1),
                            lineWidth: isSelected ? 2 : 1
                        )
                )
            
            // Pulse effect
            if pulseIntensity > 0 {
                RoundedRectangle(cornerRadius: 2)
                    .stroke(Color.white.opacity(0.3 * pulseIntensity), lineWidth: 2)
                    .scaleEffect(1 + 0.1 * pulseIntensity)
                    .blur(radius: 5 * pulseIntensity)
            }
            
            VStack(spacing: 12) {
                Text(vault.personName)
                    .font(.custom("Helvetica Neue", size: 18))
                    .fontWeight(.light)
                    .foregroundColor(.white.opacity(0.8))
                
                Text("\(vault.balance < 0 ? "-" : "")$\(abs(vault.balance))")
                    .font(.custom("Menlo", size: 12))
                    .foregroundColor(vault.balance < 0 ? Color.red.opacity(0.6) : Color.blue.opacity(0.6))
                
                // Memory indicators
                HStack(spacing: 6) {
                    ForEach(vault.memories) { memory in
                        Circle()
                            .fill(memory.type.color.opacity(0.3))
                            .frame(width: 8, height: 8)
                    }
                }
            }
            .padding(.vertical, 25)
        }
        .frame(height: 120)
        .opacity(isHovered ? 1 : 0.8)
        .scaleEffect(isSelected ? 1.02 : 1)
    }
}

struct MemoryCrystal: View {
    let memory: Memory
    let onWithdraw: () -> Void
    @State private var isHovered = false
    
    var body: some View {
        Button(action: onWithdraw) {
            ZStack {
                // Crystal shape
                GeometryReader { geometry in
                    Path { path in
                        let width = geometry.size.width
                        let height = geometry.size.height
                        
                        path.move(to: CGPoint(x: width/2, y: 0))
                        path.addLine(to: CGPoint(x: width * 0.8, y: height * 0.3))
                        path.addLine(to: CGPoint(x: width * 0.7, y: height * 0.7))
                        path.addLine(to: CGPoint(x: width/2, y: height))
                        path.addLine(to: CGPoint(x: width * 0.3, y: height * 0.7))
                        path.addLine(to: CGPoint(x: width * 0.2, y: height * 0.3))
                        path.closeSubpath()
                    }
                    .fill(memory.type.color.opacity(0.1 + 0.2 * memory.intensity))
                    .overlay(
                        Path { path in
                            let width = geometry.size.width
                            let height = geometry.size.height
                            
                            path.move(to: CGPoint(x: width/2, y: 0))
                            path.addLine(to: CGPoint(x: width * 0.8, y: height * 0.3))
                            path.addLine(to: CGPoint(x: width * 0.7, y: height * 0.7))
                            path.addLine(to: CGPoint(x: width/2, y: height))
                            path.addLine(to: CGPoint(x: width * 0.3, y: height * 0.7))
                            path.addLine(to: CGPoint(x: width * 0.2, y: height * 0.3))
                            path.closeSubpath()
                        }
                        .stroke(memory.type.color.opacity(0.3), lineWidth: 1)
                    )
                }
                .frame(width: 60, height: 80)
                
                // Fragment text
                Text(memory.fragment)
                    .font(.custom("Georgia", size: 11))
                    .foregroundColor(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .padding(.horizontal, 80)
            }
        }
        .buttonStyle(PlainButtonStyle())
        .scaleEffect(isHovered ? 1.05 : 1)
        .onHover { hovering in
            withAnimation(.easeOut(duration: 0.2)) {
                isHovered = hovering
            }
        }
    }
}

struct DraggableMemory: View {
    let withdrawn: WithdrawnMemory
    let onRemove: (UUID) -> Void
    @State private var currentPosition: CGPoint
    @State private var isDragging = false
    
    init(withdrawn: WithdrawnMemory, onRemove: @escaping (UUID) -> Void) {
        self.withdrawn = withdrawn
        self.onRemove = onRemove
        self._currentPosition = State(initialValue: withdrawn.position)
    }
    
    var body: some View {
        ZStack {
            // Glow effect
            Circle()
                .fill(withdrawn.memory.type.color.opacity(0.2))
                .blur(radius: 20)
                .frame(width: 100, height: 100)
            
            VStack(spacing: 8) {
                Circle()
                    .fill(withdrawn.memory.type.color.opacity(0.3))
                    .frame(width: 40, height: 40)
                    .overlay(
                        Circle()
                            .stroke(withdrawn.memory.type.color.opacity(0.6), lineWidth: 1)
                    )
                
                Text(withdrawn.memory.fragment)
                    .font(.custom("Georgia", size: 10))
                    .foregroundColor(.white.opacity(0.8))
                    .frame(width: 150)
                    .multilineTextAlignment(.center)
            }
        }
        .position(currentPosition)
        .scaleEffect(isDragging ? 1.1 : 1)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isDragging)
        .onDrag {
            isDragging = true
            return NSItemProvider(object: withdrawn.id.uuidString as NSString)
        }
        .gesture(
            DragGesture()
                .onChanged { value in
                    currentPosition = value.location
                }
                .onEnded { _ in
                    isDragging = false
                }
        )
    }
}

struct ParticleEffect: View {
    let dissolve: DissolveAnimation
    @State private var particles: [Particle] = []
    
    var body: some View {
        TimelineView(.animation) { timeline in
            Canvas { context, size in
                let elapsed = timeline.date.timeIntervalSince1970
                
                for particle in particles {
                    let age = elapsed - particle.birthTime
                    let lifeProgress = age / particle.lifetime
                    
                    if lifeProgress <= 1 {
                        let opacity = (1 - lifeProgress) * 0.6
                        let scale = 0.5 + lifeProgress * 0.5
                        let y = particle.position.y - age * particle.velocity
                        
                        context.opacity = opacity
                        context.fill(
                            Circle().path(in: CGRect(
                                x: particle.position.x - 2 * scale,
                                y: y - 2 * scale,
                                width: 4 * scale,
                                height: 4 * scale
                            )),
                            with: .color(dissolve.color)
                        )
                    }
                }
            }
        }
        .onAppear {
            generateParticles()
        }
    }
    
    func generateParticles() {
        let now = Date().timeIntervalSince1970
        particles = (0..<50).map { _ in
            Particle(
                position: CGPoint(
                    x: Double.random(in: -50...50),
                    y: Double.random(in: -50...50)
                ),
                velocity: Double.random(in: 20...60),
                lifetime: Double.random(in: 1...3),
                birthTime: now + Double.random(in: 0...0.5)
            )
        }
    }
}

struct Particle {
    let position: CGPoint
    let velocity: Double
    let lifetime: Double
    let birthTime: Double
}