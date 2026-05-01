struct ContentView: View {
    @State private var thoughts: [ThoughtBubble] = []
    @State private var vessels: [CrystallineVessel] = [
        CrystallineVessel(position: CGPoint(x: 360, y: 600)),
        CrystallineVessel(position: CGPoint(x: 720, y: 600)),
        CrystallineVessel(position: CGPoint(x: 1080, y: 600))
    ]
    @State private var selectedVessel: UUID?
    @State private var hoveredThought: UUID?
    
    let dreamWords = ["whisper", "dissolve", "remember", "echo", "drift", "bloom", "ripple", "gleam"]
    let thoughtTimer = Timer.publish(every: 3, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.1, green: 0.08, blue: 0.2),
                    Color(red: 0.25, green: 0.15, blue: 0.35)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            
            ForEach($vessels) { $vessel in
                vesselView(vessel: $vessel)
            }
            
            ForEach($thoughts) { $thought in
                if !thought.isCaptured {
                    thoughtBubbleView(thought: $thought)
                }
            }
        }
        .frame(width: 1440, height: 900)
        .onReceive(thoughtTimer) { _ in
            if thoughts.count < 5 {
                spawnThought()
            }
        }
    }
    
    func thoughtBubbleView(thought: Binding<ThoughtBubble>) -> some View {
        Text(thought.wrappedValue.content)
            .font(.system(size: 24, weight: .light, design: .serif))
            .foregroundColor(.white)
            .padding(20)
            .background(
                Circle()
                    .fill(Color.white.opacity(hoveredThought == thought.wrappedValue.id ? 0.15 : 0.08))
            )
            .scaleEffect(hoveredThought == thought.wrappedValue.id ? 1.1 : 1.0)
            .position(thought.wrappedValue.position)
            .onHover { hovering in
                withAnimation(.easeInOut(duration: 0.2)) {
                    hoveredThought = hovering ? thought.wrappedValue.id : nil
                }
            }
            .onTapGesture {
                if let nearestVessel = findNearestVessel(to: thought.wrappedValue.position) {
                    captureThought(thought.wrappedValue, into: nearestVessel)
                }
            }
            .animation(.easeInOut(duration: 0.3), value: hoveredThought)
    }
    
    func vesselView(vessel: Binding<CrystallineVessel>) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 20)
                .stroke(Color.white.opacity(0.3), lineWidth: 2)
                .frame(width: 200, height: 250)
                .background(
                    RoundedRectangle(cornerRadius: 20)
                        .fill(Color.white.opacity(selectedVessel == vessel.wrappedValue.id ? 0.08 : 0.02))
                )
            
            VStack(spacing: 15) {
                ForEach(vessel.wrappedValue.capturedThoughts, id: \.self) { thought in
                    Text(thought)
                        .font(.system(size: 16, weight: .light))
                        .foregroundColor(.white.opacity(0.7))
                }
            }
            .padding()
            
            if selectedVessel == vessel.wrappedValue.id {
                RoundedRectangle(cornerRadius: 20)
                    .stroke(Color(red: 0.6, green: 0.5, blue: 0.8), lineWidth: 3)
                    .frame(width: 200, height: 250)
                    .blur(radius: 8)
            }
        }
        .position(vessel.wrappedValue.position)
        .onTapGesture {
            withAnimation(.easeInOut(duration: 0.3)) {
                selectedVessel = selectedVessel == vessel.wrappedValue.id ? nil : vessel.wrappedValue.id
            }
        }
    }
    
    func spawnThought() {
        let newThought = ThoughtBubble(
            content: dreamWords.randomElement() ?? "dream",
            position: CGPoint(
                x: CGFloat.random(in: 100...1340),
                y: CGFloat.random(in: 100...350)
            )
        )
        thoughts.append(newThought)
    }
    
    func findNearestVessel(to position: CGPoint) -> Binding<CrystallineVessel>? {
        var nearestVessel: Binding<CrystallineVessel>?
        var shortestDistance: CGFloat = .infinity
        
        for index in vessels.indices {
            let distance = hypot(
                vessels[index].position.x - position.x,
                vessels[index].position.y - position.y
            )
            if distance < shortestDistance {
                shortestDistance = distance
                nearestVessel = $vessels[index]
            }
        }
        
        return nearestVessel
    }
    
    func captureThought(_ thought: ThoughtBubble, into vessel: Binding<CrystallineVessel>) {
        withAnimation(.easeInOut(duration: 0.5)) {
            if let index = thoughts.firstIndex(where: { $0.id == thought.id }) {
                thoughts[index].isCaptured = true
                vessel.wrappedValue.capturedThoughts.append(thought.content)
                
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    thoughts.removeAll { $0.id == thought.id }
                }
            }
        }
    }
}

struct ThoughtBubble: Identifiable {
    let id = UUID()
    let content: String
    var position: CGPoint
    var isCaptured = false
}

struct CrystallineVessel: Identifiable {
    let id = UUID()
    let position: CGPoint
    var capturedThoughts: [String] = []
}