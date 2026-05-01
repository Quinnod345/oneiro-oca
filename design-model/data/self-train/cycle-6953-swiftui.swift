struct ContentView: View {
    @State private var dreamFragments: [DreamFragment] = []
    @State private var mistParticles: [MistParticle] = []
    @State private var constellationNodes: [ConstellationNode] = []
    @State private var memoryCoherence: Double = 0.2
    @State private var interfaceOpacity: Double = 1.0
    @State private var selectedNodeID: UUID?
    @State private var currentDragLocation: CGPoint = .zero
    @State private var isDragging: Bool = false
    @State private var crystallizationProgress: Double = 0
    @State private var pulsePhase: Double = 0
    
    let timer = Timer.publish(every: 0.016, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            Color(red: 0.02 * memoryCoherence, 
                  green: 0.05 * memoryCoherence, 
                  blue: 0.1 + 0.15 * memoryCoherence)
                .ignoresSafeArea()
            
            GeometryReader { geometry in
                ZStack {
                    ForEach(mistParticles) { particle in
                        Circle()
                            .fill(Color(red: 0.7 + 0.3 * memoryCoherence,
                                      green: 0.8 + 0.2 * memoryCoherence,
                                      blue: 1.0))
                            .frame(width: particle.size, height: particle.size)
                            .opacity(particle.opacity * 0.3)
                            .position(particle.position)
                            .blur(radius: 2 + (1 - memoryCoherence) * 3)
                    }
                    
                    ForEach(dreamFragments) { fragment in
                        DreamFragmentView(
                            fragment: fragment,
                            memoryCoherence: memoryCoherence,
                            crystallizationProgress: crystallizationProgress
                        )
                    }
                    
                    Circle()
                        .stroke(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.3, green: 0.4, blue: 0.6).opacity(0.2 * interfaceOpacity),
                                    Color(red: 0.5, green: 0.6, blue: 0.8).opacity(0.4 * interfaceOpacity)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 2
                        )
                        .frame(width: 500, height: 500)
                        .position(x: geometry.size.width / 2, y: geometry.size.height / 2)
                        .opacity(interfaceOpacity)
                    
                    ForEach(constellationNodes) { node in
                        ConstellationNodeView(
                            node: node,
                            isSelected: selectedNodeID == node.id,
                            memoryCoherence: memoryCoherence,
                            pulsePhase: pulsePhase
                        )
                        .onTapGesture {
                            withAnimation(.easeInOut(duration: 0.6)) {
                                selectedNodeID = node.id
                                addDreamFragment(at: node.position)
                            }
                        }
                    }
                    
                    if isDragging {
                        Path { path in
                            if let selectedID = selectedNodeID,
                               let node = constellationNodes.first(where: { $0.id == selectedID }) {
                                path.move(to: node.position)
                                path.addLine(to: currentDragLocation)
                            }
                        }
                        .stroke(
                            Color(red: 0.6, green: 0.7, blue: 0.9).opacity(0.5),
                            style: StrokeStyle(lineWidth: 1, dash: [5, 3])
                        )
                    }
                    
                    VStack {
                        HStack {
                            Text("DREAM DECAY CALCULATOR")
                                .font(.system(size: 12, weight: .ultraLight, design: .monospaced))
                                .foregroundColor(Color.white.opacity(0.6 * interfaceOpacity))
                                .tracking(3)
                            
                            Spacer()
                            
                            Text("COHERENCE: \(Int(memoryCoherence * 100))%")
                                .font(.system(size: 11, weight: .thin, design: .monospaced))
                                .foregroundColor(Color.white.opacity(0.5 * interfaceOpacity))
                        }
                        .padding(.horizontal, 40)
                        .padding(.top, 30)
                        
                        Spacer()
                        
                        if memoryCoherence < 0.3 {
                            Text("fragments dissolving into the void")
                                .font(.system(size: 14, weight: .ultraLight, design: .serif))
                                .foregroundColor(Color.white.opacity(0.3 * interfaceOpacity))
                                .italic()
                                .padding(.bottom, 40)
                        }
                    }
                }
                .onAppear {
                    setupConstellation(in: geometry.size)
                    setupMistParticles(in: geometry.size)
                }
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            isDragging = true
                            currentDragLocation = value.location
                        }
                        .onEnded { value in
                            isDragging = false
                            if let _ = selectedNodeID {
                                createConnectionNode(at: value.location)
                            }
                        }
                )
                .onReceive(timer) { _ in
                    updateAnimation()
                }
            }
        }
    }
    
    func setupConstellation(in size: CGSize) {
        for _ in 0..<8 {
            let node = ConstellationNode(
                position: CGPoint(
                    x: CGFloat.random(in: 100...size.width - 100),
                    y: CGFloat.random(in: 100...size.height - 100)
                ),
                connections: []
            )
            constellationNodes.append(node)
        }
    }
    
    func setupMistParticles(in size: CGSize) {
        for _ in 0..<20 {
            let particle = MistParticle(
                position: CGPoint(
                    x: CGFloat.random(in: 0...size.width),
                    y: CGFloat.random(in: 0...size.height)
                ),
                opacity: Double.random(in: 0.3...0.8),
                size: Double.random(in: 30...100)
            )
            mistParticles.append(particle)
        }
    }
    
    func addDreamFragment(at position: CGPoint) {
        let fragment = DreamFragment(
            position: position,
            opacity: 0.8,
            scale: 1.0,
            rotation: Double.random(in: -45...45)
        )
        dreamFragments.append(fragment)
        
        withAnimation(.easeInOut(duration: 2.0)) {
            memoryCoherence = min(1.0, memoryCoherence + 0.1)
            crystallizationProgress = min(1.0, crystallizationProgress + 0.15)
        }
    }
    
    func createConnectionNode(at position: CGPoint) {
        let node = ConstellationNode(
            position: position,
            connections: selectedNodeID != nil ? [selectedNodeID!] : []
        )
        constellationNodes.append(node)
    }
    
    func updateAnimation() {
        pulsePhase += 0.05
        
        for index in mistParticles.indices {
            mistParticles[index].position.x += CGFloat.random(in: -1...1)
            mistParticles[index].position.y += CGFloat.random(in: -0.5...0.5)
            mistParticles[index].opacity = max(0.1, mistParticles[index].opacity - 0.001)
        }
        
        if memoryCoherence > 0.05 {
            memoryCoherence -= 0.0005
        }
        
        if crystallizationProgress > 0 {
            crystallizationProgress -= 0.001
        }
        
        for index in dreamFragments.indices {
            dreamFragments[index].opacity = max(0, dreamFragments[index].opacity - 0.002)
            dreamFragments[index].scale = max(0.1, dreamFragments[index].scale - 0.001)
            dreamFragments[index].rotation += 0.2
        }
        
        dreamFragments.removeAll { $0.opacity <= 0 }
    }
}