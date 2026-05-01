struct ContentView: View {
    @State private var memories: [Memory] = [
        Memory(
            content: "First day of school, september rain",
            intensity: 0.8,
            position: CGPoint(x: 300, y: 200),
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
            position: CGPoint(x: 700, y: 350),
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
            position: CGPoint(x: 1100, y: 250),
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
            position: CGPoint(x: 500, y: 500),
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
    @State private var isDragging: Bool = false
    @State private var dragOffset: CGSize = .zero
    
    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()
            
            ForEach(particles) { particle in
                Circle()
                    .fill(particle.color)
                    .frame(width: 4 * particle.scale, height: 4 * particle.scale)
                    .blur(radius: 2)
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
                    withAnimation(.easeInOut(duration: 0.3)) {
                        hoveredMemory = hovering ? memory.id : nil
                    }
                }
                .onTapGesture {
                    if selectedMemory == nil {
                        withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
                            selectedMemory = memory.id
                        }
                    } else if selectedMemory != memory.id && sacrificeMemory == nil {
                        beginSacrifice(memory)
                    }
                }
            }
            
            VStack {
                HStack {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("EMOTIONAL CURRENCY")
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundColor(Color.white.opacity(0.5))
                            .tracking(2)
                        
                        HStack(spacing: 16) {
                            EmotionalMeter(value: emotionalBalance)
                            
                            if reclamationProgress > 0 {
                                ReclamationIndicator(progress: reclamationProgress)
                            }
                        }
                    }
                    
                    Spacer()
                    
                    if selectedMemory != nil {
                        VStack(alignment: .trailing, spacing: 8) {
                            Text("AWAITING SACRIFICE")
                                .font(.system(size: 10, weight: .regular, design: .monospaced))
                                .foregroundColor(Color.orange.opacity(0.7))
                                .tracking(1.5)
                            
                            Button(action: cancelSelection) {
                                Text("CANCEL")
                                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 6)
                                    .background(Color.white.opacity(0.1))
                                    .cornerRadius(4)
                            }
                        }
                    }
                }
                .padding()
                
                Spacer()
            }
        }
        .onAppear {
            startParticleAnimation()
        }
    }
    
    func beginSacrifice(_ memory: Memory) -> Void {
        withAnimation(.easeOut(duration: 0.8)) {
            sacrificeMemory = memory.id
            emotionalBalance = max(0, emotionalBalance - memory.intensity * 20)
            
            if let selectedIndex = memories.firstIndex(where: { $0.id == selectedMemory }) {
                memories[selectedIndex].intensity = min(1.0, memories[selectedIndex].intensity + memory.intensity * 0.3)
            }
        }
        
        createSacrificeParticles(at: memory.position)
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            memories.removeAll { $0.id == memory.id }
            selectedMemory = nil
            sacrificeMemory = nil
            startReclamation()
        }
    }
    
    func cancelSelection() -> Void {
        withAnimation(.easeOut(duration: 0.3)) {
            selectedMemory = nil
        }
    }
    
    func createSacrificeParticles(at position: CGPoint) -> Void {
        for _ in 0..<20 {
            let particle = SacrificedParticle(
                position: position,
                velocity: CGSize(
                    width: Double.random(in: -100...100),
                    height: Double.random(in: -100...100)
                ),
                color: [Color.cyan, Color.purple, Color.blue, Color.white].randomElement()!,
                opacity: Double.random(in: 0.5...1.0),
                scale: Double.random(in: 0.5...1.5)
            )
            particles.append(particle)
        }
    }
    
    func startParticleAnimation() -> Void {
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            withAnimation(.linear(duration: 0.05)) {
                for index in particles.indices {
                    particles[index].position.x += particles[index].velocity.width * 0.05
                    particles[index].position.y += particles[index].velocity.height * 0.05
                    particles[index].opacity -= 0.02
                    particles[index].velocity.width *= 0.98
                    particles[index].velocity.height *= 0.98
                }
                particles.removeAll { $0.opacity <= 0 }
            }
        }
    }
    
    func startReclamation() -> Void {
        reclamationProgress = 0.0
        
        Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { timer in
            withAnimation(.linear(duration: 0.1)) {
                reclamationProgress += 0.02
                emotionalBalance = min(100, emotionalBalance + 0.5)
                
                if reclamationProgress >= 1.0 {
                    timer.invalidate()
                    reclamationProgress = 0.0
                }
            }
        }
    }
}