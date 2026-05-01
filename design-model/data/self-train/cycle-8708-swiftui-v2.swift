struct ContentView: View {
    @State private var memories: [Memory] = [
        Memory(
            content: "First day of school, september rain",
            intensity: 0.8,
            position: CGPoint(x: 300, y: 300),
            scale: 1.0,
            rotation: -15,
            fragments: [
                MemoryFragment(text: "yellow raincoat", offset: CGSize(width: -30, height: 20), opacity: 0.6, blur: 2),
                MemoryFragment(text: "mother's hand", offset: CGSize(width: 40, height: -30), opacity: 0.4, blur: 4)
            ]
        ),
        Memory(
            content: "Grandfather's workshop, sawdust and varnish",
            intensity: 0.6,
            position: CGPoint(x: 700, y: 400),
            scale: 0.9,
            rotation: 8,
            fragments: [
                MemoryFragment(text: "carved wooden bird", offset: CGSize(width: 20, height: 40), opacity: 0.5, blur: 3),
                MemoryFragment(text: "rough hands", offset: CGSize(width: -40, height: -20), opacity: 0.3, blur: 5)
            ]
        ),
        Memory(
            content: "Summer nights, fireflies in mason jars",
            intensity: 0.9,
            position: CGPoint(x: 1100, y: 350),
            scale: 1.1,
            rotation: -5,
            fragments: [
                MemoryFragment(text: "grass stains", offset: CGSize(width: 0, height: 50), opacity: 0.7, blur: 1),
                MemoryFragment(text: "cicada songs", offset: CGSize(width: -50, height: 0), opacity: 0.4, blur: 4)
            ]
        ),
        Memory(
            content: "Kitchen table conversations at 3am",
            intensity: 0.7,
            position: CGPoint(x: 500, y: 550),
            scale: 0.85,
            rotation: 12,
            fragments: [
                MemoryFragment(text: "cold tea", offset: CGSize(width: 30, height: -40), opacity: 0.5, blur: 3),
                MemoryFragment(text: "whispered truths", offset: CGSize(width: -20, height: 30), opacity: 0.6, blur: 2)
            ]
        ),
        Memory(
            content: "Last train home, empty platform",
            intensity: 0.5,
            position: CGPoint(x: 900, y: 600),
            scale: 0.95,
            rotation: -20,
            fragments: [
                MemoryFragment(text: "flickering lights", offset: CGSize(width: 45, height: 15), opacity: 0.4, blur: 4),
                MemoryFragment(text: "echoing footsteps", offset: CGSize(width: -35, height: -25), opacity: 0.3, blur: 5)
            ]
        )
    ]
    
    @State private var hoveredMemory: UUID?
    @State private var selectedMemory: UUID?
    @State private var sacrificeMemory: UUID?
    @State private var particles: [SacrificedParticle] = []
    @State private var emotionalBalance: Double = 100.0
    @State private var reclamationProgress: Double = 0.0
    
    let memoryGradient = LinearGradient(
        colors: [Color(white: 0.95), Color(white: 0.85)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
    
    let backgroundGradient = LinearGradient(
        colors: [Color(red: 0.05, green: 0.05, blue: 0.08), Color(red: 0.02, green: 0.02, blue: 0.04)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
    
    var body: some View {
        ZStack {
            backgroundGradient
                .ignoresSafeArea()
            
            ForEach(particles) { particle in
                Circle()
                    .fill(particle.color)
                    .frame(width: 3 * particle.scale, height: 3 * particle.scale)
                    .blur(radius: 1)
                    .opacity(particle.opacity)
                    .position(particle.position)
            }
            
            ForEach(memories) { memory in
                MemorySphere(
                    memory: memory,
                    isHovered: hoveredMemory == memory.id,
                    isSelected: selectedMemory == memory.id,
                    isSacrifice: sacrificeMemory == memory.id,
                    isOtherHovered: hoveredMemory != nil && hoveredMemory != memory.id
                )
                .position(memory.position)
                .onHover { hovering in
                    withAnimation(.easeInOut(duration: 0.2)) {
                        hoveredMemory = hovering ? memory.id : nil
                    }
                }
                .onTapGesture {
                    handleMemoryTap(memory)
                }
            }
            
            VStack(spacing: 0) {
                HeaderView(emotionalBalance: emotionalBalance, reclamationProgress: reclamationProgress)
                    .padding(.horizontal, 40)
                    .padding(.top, 40)
                
                Spacer()
                
                if selectedMemory != nil {
                    ActionPanel(
                        selectedMemory: memories.first { $0.id == selectedMemory },
                        onCancel: cancelSelection,
                        onConfirm: confirmSacrifice
                    )
                    .padding(40)
                }
            }
        }
        .onAppear {
            startParticleAnimation()
        }
    }
    
    func handleMemoryTap(_ memory: Memory) {
        if selectedMemory == nil {
            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                selectedMemory = memory.id
            }
        } else if selectedMemory != memory.id && sacrificeMemory == nil {
            beginSacrifice(memory)
        }
    }
    
    func beginSacrifice(_ memory: Memory) {
        withAnimation(.easeInOut(duration: 0.6)) {
            sacrificeMemory = memory.id
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            completeSacrifice(memory)
        }
    }
    
    func completeSacrifice(_ memory: Memory) {
        let selectedMemoryIntensity = memories.first { $0.id == selectedMemory }?.intensity ?? 0
        
        withAnimation(.easeOut(duration: 0.4)) {
            memories.removeAll { $0.id == memory.id }
            emotionalBalance = max(0, emotionalBalance - memory.intensity * 20)
            reclamationProgress = min(100, reclamationProgress + memory.intensity * 15 + selectedMemoryIntensity * 10)
        }
        
        createSacrificeParticles(at: memory.position, color: intensityColor(memory.intensity))
        
        selectedMemory = nil
        sacrificeMemory = nil
    }
    
    func cancelSelection() {
        withAnimation(.easeInOut(duration: 0.3)) {
            selectedMemory = nil
        }
    }
    
    func confirmSacrifice() {
        // Implementation for confirmation
    }
    
    func createSacrificeParticles(at position: CGPoint, color: Color) {
        for _ in 0..<20 {
            let angle = Double.random(in: 0...(2 * .pi))
            let speed = Double.random(in: 2...5)
            let particle = SacrificedParticle(
                position: position,
                velocity: CGSize(width: cos(angle) * speed, height: sin(angle) * speed),
                color: color,
                opacity: 1.0,
                scale: Double.random(in: 0.8...1.5)
            )
            particles.append(particle)
        }
    }
    
    func startParticleAnimation() {
        Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { _ in
            particles = particles.compactMap { particle in
                var updated = particle
                updated.position.x += updated.velocity.width
                updated.position.y += updated.velocity.height
                updated.velocity.width *= 0.98
                updated.velocity.height *= 0.98
                updated.opacity *= 0.96
                
                return updated.opacity > 0.01 ? updated : nil
            }
        }
    }
    
    func intensityColor(_ intensity: Double) -> Color {
        let hue = 0.6 - intensity * 0.15
        return Color(hue: hue, saturation: 0.7, brightness: 0.9)
    }
}

struct MemorySphere: View {
    let memory: Memory
    let isHovered: Bool
    let isSelected: Bool
    let isSacrifice: Bool
    let isOtherHovered: Bool
    
    var body: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            intensityColor(memory.intensity).opacity(0.3),
                            intensityColor(memory.intensity).opacity(0.1)
                        ],
                        center: .center,
                        startRadius: 20,
                        endRadius: 80
                    )
                )
                .frame(width: 160, height: 160)
                .blur(radius: isHovered ? 8 : 12)
                .opacity(isOtherHovered ? 0.3 : 0.8)
            
            Circle()
                .stroke(
                    intensityColor(memory.intensity).opacity(isSelected ? 0.8 : 0.4),
                    lineWidth: isSelected ? 3 : 1
                )
                .frame(width: 100 * memory.scale, height: 100 * memory.scale)
                .blur(radius: isHovered ? 0 : 1)
            
            VStack(spacing: 8) {
                Text(memory.content)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.white.opacity(0.9))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .frame(width: 140)
                
                if isHovered {
                    Text("\(Int(memory.intensity * 100))% intensity")
                        .font(.system(size: 11, weight: .regular))
                        .foregroundColor(.white.opacity(0.5))
                }
            }
            .opacity(isSacrifice ? 0 : 1)
            
            ForEach(memory.fragments, id: \.text) { fragment in
                Text(fragment.text)
                    .font(.system(size: 10, weight: .light))
                    .foregroundColor(.white.opacity(fragment.opacity))
                    .blur(radius: fragment.blur)
                    .offset(fragment.offset)
                    .opacity(isHovered ? 1 : 0)
            }
        }
        .rotationEffect(.degrees(memory.rotation))
        .scaleEffect(isHovered ? 1.15 : (isSelected ? 1.1 : 1.0))
        .scaleEffect(isSacrifice ? 0 : 1)
        .opacity(isSacrifice ? 0 : 1)
    }
    
    func intensityColor(_ intensity: Double) -> Color {
        let hue = 0.6 - intensity * 0.15
        return Color(hue: hue, saturation: 0.7, brightness: 0.9)
    }
}

struct HeaderView: View {
    let emotionalBalance: Double
    let reclamationProgress: Double
    
    var body: some View {
        HStack(spacing: 60) {
            VStack(alignment: .leading, spacing: 16) {
                Text("EMOTIONAL BALANCE")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.white.opacity(0.5))
                    .tracking(1.5)
                
                HStack(spacing: 12) {
                    ProgressBar(value: emotionalBalance / 100, color: balanceColor)
                        .frame(width: 200, height: 6)
                    
                    Text("\(Int(emotionalBalance))%")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white.opacity(0.8))
                        .frame(width: 50, alignment: .trailing)
                }
            }
            
            VStack(alignment: .leading, spacing: 16) {
                Text("RECLAMATION PROGRESS")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.white.opacity(0.5))
                    .tracking(1.5)
                
                HStack(spacing: 12) {
                    ProgressBar(value: reclamationProgress / 100, color: Color.purple)
                        .frame(width: 200, height: 6)
                    
                    Text("\(Int(reclamationProgress))%")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white.opacity(0.8))
                        .frame(width: 50, alignment: .trailing)
                }
            }
            
            Spacer()
        }
    }
    
    var balanceColor: Color {
        if emotionalBalance > 60 {
            return Color.cyan
        } else if emotionalBalance > 30 {
            return Color.orange
        } else {
            return Color.red
        }
    }
}

struct ProgressBar: View {
    let value: Double
    let color: Color
    
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 3)
                    .fill(Color.white.opacity(0.1))
                
                RoundedRectangle(cornerRadius: 3)
                    .fill(color)
                    .frame(width: geometry.size.width * value)
            }
        }
    }
}

struct ActionPanel: View {
    let selectedMemory: Memory?
    let onCancel: () -> Void
    let onConfirm: () -> Void
    
    var body: some View {
        HStack(spacing: 20) {
            if let memory = selectedMemory {
                VStack(alignment: .leading, spacing: 12) {
                    Text("SELECTED MEMORY")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.white.opacity(0.5))
                        .tracking(1.5)
                    
                    Text(memory.content)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white.opacity(0.9))
                    
                    Text("Select another memory to sacrifice for reclamation")
                        .font(.system(size: 14, weight: .regular))
                        .foregroundColor(.white.opacity(0.6))
                }
                
                Spacer()
                
                Button(action: onCancel) {
                    Text("Cancel")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.white.opacity(0.8))
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .background(Color.white.opacity(0.1))
                        .cornerRadius(8)
                }
            }
        }
        .padding(24)
        .background(Color.black.opacity(0.4))
        .cornerRadius(12)
    }
}