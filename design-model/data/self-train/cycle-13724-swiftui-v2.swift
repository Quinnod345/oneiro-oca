struct ContentView: View {
    @State private var memories: [MemoryParticle] = []
    @State private var selectedMemory: MemoryParticle?
    @State private var offset = CGSize.zero
    @State private var zoom: Double = 1.0
    @State private var showingMemoryDetail = false
    
    let backgroundGradient = LinearGradient(
        colors: [
            Color(red: 0.05, green: 0.05, blue: 0.15),
            Color(red: 0.02, green: 0.02, blue: 0.08)
        ],
        startPoint: .top,
        endPoint: .bottom
    )
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                backgroundGradient
                    .ignoresSafeArea()
                    .overlay(
                        StarfieldView()
                            .ignoresSafeArea()
                    )
                
                ScrollView([.horizontal, .vertical], showsIndicators: false) {
                    ZStack {
                        ForEach(Array(memories.enumerated()), id: \.element.id) { index, memory in
                            let connections = memories.filter { 
                                memory.connections.contains($0.id)
                            }
                            
                            ForEach(connections) { connectedMemory in
                                ConstellationPath(points: [
                                    memory.position,
                                    connectedMemory.position
                                ])
                                .stroke(
                                    LinearGradient(
                                        colors: [
                                            memory.type.color.opacity(0.3),
                                            connectedMemory.type.color.opacity(0.3)
                                        ],
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    ),
                                    style: StrokeStyle(
                                        lineWidth: 1,
                                        lineCap: .round,
                                        dash: [5, 10]
                                    )
                                )
                                .animation(.easeInOut(duration: 0.5), value: memories.count)
                            }
                        }
                        
                        ForEach(memories) { memory in
                            MemoryNodeView(
                                memory: memory,
                                isSelected: selectedMemory?.id == memory.id,
                                scale: zoom
                            )
                            .position(memory.position)
                            .onTapGesture {
                                withAnimation(.spring()) {
                                    selectedMemory = memory
                                    showingMemoryDetail = true
                                }
                            }
                        }
                    }
                    .frame(width: 2000, height: 2000)
                    .scaleEffect(zoom)
                    .offset(offset)
                }
                .gesture(
                    MagnificationGesture()
                        .onChanged { value in
                            zoom = min(max(value, 0.5), 2.0)
                        }
                )
                
                VStack {
                    HStack {
                        Text("Memory Constellation")
                            .font(.custom("Georgia", size: 32))
                            .foregroundColor(.white)
                            .shadow(color: .black.opacity(0.5), radius: 2, x: 0, y: 1)
                        
                        Spacer()
                        
                        Button(action: addNewMemory) {
                            Label("Add Memory", systemImage: "plus.circle.fill")
                                .font(.custom("Georgia", size: 16))
                                .foregroundColor(.white)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                                .background(
                                    Capsule()
                                        .fill(Color.white.opacity(0.1))
                                        .background(
                                            Capsule()
                                                .stroke(Color.white.opacity(0.2), lineWidth: 1)
                                        )
                                )
                        }
                        .buttonStyle(PlainButtonStyle())
                    }
                    .padding()
                    
                    Spacer()
                }
                
                if let selectedMemory = selectedMemory, showingMemoryDetail {
                    Color.black.opacity(0.4)
                        .ignoresSafeArea()
                        .onTapGesture {
                            withAnimation {
                                showingMemoryDetail = false
                                self.selectedMemory = nil
                            }
                        }
                    
                    MemoryDetailCard(
                        memory: selectedMemory,
                        isShowing: $showingMemoryDetail
                    )
                    .transition(.opacity.combined(with: .scale))
                    .zIndex(1)
                }
            }
        }
        .onAppear {
            generateInitialMemories()
        }
    }
    
    func addNewMemory() {
        let newMemory = MemoryParticle(
            position: CGPoint(
                x: CGFloat.random(in: 200...800),
                y: CGFloat.random(in: 200...800)
            ),
            title: "New Memory",
            date: Date(),
            type: MemoryParticle.MemoryType.allCases.randomElement()!,
            gravitationalMass: Double.random(in: 0.5...2.0)
        )
        
        if let lastMemory = memories.last {
            newMemory.connections.insert(lastMemory.id)
            memories[memories.count - 1].connections.insert(newMemory.id)
        }
        
        withAnimation(.spring()) {
            memories.append(newMemory)
        }
    }
    
    func generateInitialMemories() {
        let titles = [
            "First Day of School", "Learning to Ride", "Summer Adventure",
            "Family Reunion", "Career Milestone", "Unexpected Friendship",
            "Moment of Clarity", "Overcoming Fear", "Creative Breakthrough"
        ]
        
        for i in 0..<9 {
            let memory = MemoryParticle(
                position: CGPoint(
                    x: 400 + cos(Double(i) * .pi / 4.5) * 200,
                    y: 400 + sin(Double(i) * .pi / 4.5) * 200
                ),
                title: titles[i],
                date: Date().addingTimeInterval(TimeInterval(-86400 * Double.random(in: 1...365) * Double(i + 1))),
                type: MemoryParticle.MemoryType.allCases.randomElement()!,
                gravitationalMass: Double.random(in: 0.5...2.0)
            )
            
            if i > 0 {
                let connectionIndex = Int.random(in: 0..<i)
                memory.connections.insert(memories[connectionIndex].id)
                memories[connectionIndex].connections.insert(memory.id)
            }
            
            memories.append(memory)
        }
    }
}

struct StarfieldView: View {
    @State private var animateStars = false
    
    var body: some View {
        GeometryReader { geometry in
            ForEach(0..<100, id: \.self) { index in
                Circle()
                    .fill(Color.white)
                    .frame(width: CGFloat.random(in: 0.5...2))
                    .position(
                        x: CGFloat.random(in: 0...geometry.size.width),
                        y: CGFloat.random(in: 0...geometry.size.height)
                    )
                    .opacity(Double.random(in: 0.1...0.5))
                    .scaleEffect(animateStars ? 1.2 : 0.8)
                    .animation(
                        Animation.easeInOut(duration: Double.random(in: 2...5))
                            .repeatForever(autoreverses: true)
                            .delay(Double.random(in: 0...2)),
                        value: animateStars
                    )
            }
        }
        .onAppear {
            animateStars = true
        }
    }
}