struct ContentView: View {
    @State private var dreamOrbs: [DreamOrb] = []
    @State private var selectedOrb: UUID?
    @State private var constellationPoints: [ConstellationPoint] = []
    @State private var activeThreads: [CGPoint] = []
    @State private var bidThreads: [BidThread] = []
    @State private var ghostBidders: [GhostBidder] = []
    @State private var currentBidValue: Double = 0
    @State private var sleepJournal: [DreamPage] = []
    @State private var hoveredPoint: UUID?
    @State private var draggedFrom: ConstellationPoint?
    @State private var viewMode: ViewMode = .auction
    @State private var journalOffset: CGFloat = 0
    @State private var activePageIndex: Int = 0
    
    enum ViewMode {
        case auction, journal
    }
    
    let timer = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Deep sleep background
                Rectangle()
                    .fill(Color(red: 0.02, green: 0.02, blue: 0.04))
                    .overlay(
                        ForEach(0..<30, id: \.self) { i in
                            Circle()
                                .fill(Color(red: 0.1, green: 0.05, blue: 0.15))
                                .opacity(0.03)
                                .frame(width: CGFloat.random(in: 200...600))
                                .position(
                                    x: CGFloat.random(in: 0...geometry.size.width),
                                    y: CGFloat.random(in: 0...geometry.size.height)
                                )
                                .blur(radius: 40)
                        }
                    )
                
                if viewMode == .auction {
                    // Dream orbs floating
                    ForEach(dreamOrbs) { orb in
                        DreamOrbView(
                            orb: orb,
                            isSelected: selectedOrb == orb.id,
                            geometry: geometry
                        )
                        .onTapGesture {
                            withAnimation(.spring(response: 0.8, dampingFraction: 0.7)) {
                                selectedOrb = orb.id
                                generateConstellationPoints()
                            }
                        }
                    }
                    
                    // Ghost bidders
                    ForEach(ghostBidders) { bidder in
                        GhostBidderView(bidder: bidder)
                    }
                    
                    // Dream catcher interface
                    if selectedOrb != nil {
                        DreamCatcherView(
                            constellationPoints: $constellationPoints,
                            activeThreads: $activeThreads,
                            currentBidValue: $currentBidValue,
                            hoveredPoint: $hoveredPoint,
                            draggedFrom: $draggedFrom,
                            onBidSubmit: submitBid
                        )
                    }
                    
                    // Active bid threads
                    ForEach(bidThreads) { thread in
                        BidThreadView(thread: thread)
                    }
                    
                } else {
                    // Sleep journal visualization
                    SleepJournalView(
                        pages: $sleepJournal,
                        activePageIndex: $activePageIndex,
                        journalOffset: $journalOffset
                    )
                }
                
                // Mode switcher
                VStack {
                    HStack {
                        Spacer()
                        HStack(spacing: 20) {
                            Button(action: { 
                                withAnimation(.easeInOut(duration: 0.6)) {
                                    viewMode = .auction
                                }
                            }) {
                                Text("Auction House")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundColor(viewMode == .auction ? Color.white : Color.gray)
                            }
                            .buttonStyle(.plain)
                            
                            Text("|")
                                .foregroundColor(Color(red: 0.3, green: 0.3, blue: 0.4))
                            
                            Button(action: {
                                withAnimation(.easeInOut(duration: 0.6)) {
                                    viewMode = .journal
                                }
                            }) {
                                Text("Sleep Journal")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundColor(viewMode == .journal ? Color.white : Color.gray)
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.horizontal, 30)
                        .padding(.vertical, 15)
                        .background(
                            RoundedRectangle(cornerRadius: 20)
                                .fill(Color(red: 0.1, green: 0.1, blue: 0.15).opacity(0.8))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 20)
                                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                                )
                        )
                    }
                    .padding(40)
                    Spacer()
                }
            }
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            initializeDreams()
            initializeGhostBidders()
        }
        .onReceive(timer) { _ in
            updateAnimations()
        }
    }
    
    func initializeDreams() {
        for _ in 0..<5 {
            let orb = DreamOrb(
                position: CGPoint(
                    x: CGFloat.random(in: 100...1340),
                    y: CGFloat.random(in: 100...800)
                ),
                size: CGFloat.random(in: 80...150),
                color: [Color.purple, Color.pink, Color.blue, Color.orange].randomElement()!,
                intensity: Double.random(in: 0.3...0.8),
                phase: Double.random(in: 0...2 * .pi)
            )
            dreamOrbs.append(orb)
        }
    }
    
    func initializeGhostBidders() {
        for _ in 0..<3 {
            let bidder = GhostBidder(
                position: CGPoint(
                    x: CGFloat.random(in: 100...1340),
                    y: CGFloat.random(in: 100...800)
                ),
                targetOrb: dreamOrbs.randomElement()?.id,
                opacity: 0.3
            )
            ghostBidders.append(bidder)
        }
    }
    
    func generateConstellationPoints() {
        constellationPoints.removeAll()
        let count = Int.random(in: 6...10)
        for _ in 0..<count {
            let point = ConstellationPoint(
                position: CGPoint(
                    x: CGFloat.random(in: 300...1140),
                    y: CGFloat.random(in: 200...700)
                ),
                value: Double.random(in: 10...100),
                isActive: false
            )
            constellationPoints.append(point)
        }
    }
    
    func submitBid() {
        let thread = BidThread(
            startPoint: CGPoint(x: 720, y: 450),
            endPoint: CGPoint(
                x: CGFloat.random(in: 100...1340),
                y: CGFloat.random(in: 100...800)
            ),
            progress: 0,
            color: Color.purple
        )
        bidThreads.append(thread)
        
        let page = DreamPage(
            content: "Bid placed: \(Int(currentBidValue)) dream tokens",
            timestamp: Date(),
            dreamIntensity: currentBidValue / 100
        )
        sleepJournal.append(page)
    }
    
    func updateAnimations() {
        // Update dream orb positions
        for i in dreamOrbs.indices {
            dreamOrbs[i].phase += 0.05
            let offsetX = sin(dreamOrbs[i].phase) * 2
            let offsetY = cos(dreamOrbs[i].phase * 1.3) * 2
            dreamOrbs[i].position.x += offsetX
            dreamOrbs[i].position.y += offsetY
        }
        
        // Update ghost bidders
        for i in ghostBidders.indices {
            ghostBidders[i].opacity = Double.random(in: 0.2...0.5)
            if let targetId = ghostBidders[i].targetOrb,
               let targetOrb = dreamOrbs.first(where: { $0.id == targetId }) {
                let dx = targetOrb.position.x - ghostBidders[i].position.x
                let dy = targetOrb.position.y - ghostBidders[i].position.y
                ghostBidders[i].position.x += dx * 0.02
                ghostBidders[i].position.y += dy * 0.02
            }
        }
        
        // Update bid threads
        bidThreads = bidThreads.compactMap { thread in
            var updatedThread = thread
            updatedThread.progress += 0.05
            return updatedThread.progress < 1 ? updatedThread : nil
        }
    }
}

struct DreamOrbView: View {
    let orb: DreamOrb
    let isSelected: Bool
    let geometry: GeometryProxy
    
    var body: some View {
        Circle()
            .fill(
                RadialGradient(
                    gradient: Gradient(colors: [
                        orb.color.opacity(orb.intensity),
                        orb.color.opacity(orb.intensity * 0.3),
                        Color.clear
                    ]),
                    center: .center,
                    startRadius: 0,
                    endRadius: orb.size / 2
                )
            )
            .frame(width: orb.size, height: orb.size)
            .blur(radius: isSelected ? 0 : 3)
            .overlay(
                Circle()
                    .stroke(Color.white.opacity(isSelected ? 0.8 : 0), lineWidth: 2)
                    .blur(radius: 2)
            )
            .position(orb.position)
            .scaleEffect(isSelected ? 1.2 : 1)
    }
}

struct GhostBidderView: View {
    let bidder: GhostBidder
    
    var body: some View {
        Circle()
            .fill(Color.white.opacity(bidder.opacity * 0.2))
            .frame(width: 40, height: 40)
            .blur(radius: 10)
            .position(bidder.position)
    }
}

struct BidThreadView: View {
    let thread: BidThread
    
    var body: some View {
        Path { path in
            path.move(to: thread.startPoint)
            let controlPoint = CGPoint(
                x: (thread.startPoint.x + thread.endPoint.x) / 2,
                y: (thread.startPoint.y + thread.endPoint.y) / 2 - 100
            )
            path.addQuadCurve(to: thread.endPoint, control: controlPoint)
        }
        .trim(from: 0, to: thread.progress)
        .stroke(
            LinearGradient(
                gradient: Gradient(colors: [thread.color, thread.color.opacity(0)]),
                startPoint: .leading,
                endPoint: .trailing
            ),
            style: StrokeStyle(lineWidth: 2, lineCap: .round)
        )
        .blur(radius: 1)
    }
}

struct DreamCatcherView: View {
    @Binding var constellationPoints: [ConstellationPoint]
    @Binding var activeThreads: [CGPoint]
    @Binding var currentBidValue: Double
    @Binding var hoveredPoint: UUID?
    @Binding var draggedFrom: ConstellationPoint?
    let onBidSubmit: () -> Void
    
    var body: some View {
        ZStack {
            // Constellation connections
            ForEach(Array(constellationPoints.enumerated()), id: \.offset) { index, point in
                if index < constellationPoints.count - 1 {
                    Path { path in
                        path.move(to: point.position)
                        path.addLine(to: constellationPoints[index + 1].position)
                    }
                    .stroke(Color.white.opacity(0.1), lineWidth: 1)
                }
            }
            
            // Constellation points
            ForEach(constellationPoints) { point in
                Circle()
                    .fill(Color.white.opacity(point.isActive ? 0.8 : 0.3))
                    .frame(width: 20, height: 20)
                    .position(point.position)
                    .scaleEffect(hoveredPoint == point.id ? 1.5 : 1)
                    .onHover { isHovered in
                        hoveredPoint = isHovered ? point.id : nil
                    }
            }
            
            // Bid button
            VStack {
                Spacer()
                Button(action: onBidSubmit) {
                    Text("Submit Dream Bid: \(Int(currentBidValue))")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white)
                        .padding(.horizontal, 30)
                        .padding(.vertical, 15)
                        .background(
                            RoundedRectangle(cornerRadius: 25)
                                .fill(Color.purple.opacity(0.8))
                        )
                }
                .buttonStyle(.plain)
                .padding(.bottom, 50)
            }
        }
    }
}

struct SleepJournalView: View {
    @Binding var pages: [DreamPage]
    @Binding var activePageIndex: Int
    @Binding var journalOffset: CGFloat
    
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 50) {
                ForEach(Array(pages.enumerated()), id: \.element.id) { index, page in
                    VStack(alignment: .leading, spacing: 20) {
                        Text("Dream Entry #\(index + 1)")
                            .font(.system(size: 24, weight: .light))
                            .foregroundColor(.white)
                        
                        Text(page.content)
                            .font(.system(size: 16))
                            .foregroundColor(Color.white.opacity(0.7))
                        
                        Text(page.timestamp, style: .date)
                            .font(.system(size: 14))
                            .foregroundColor(Color.white.opacity(0.5))
                        
                        HStack {
                            Text("Intensity:")
                                .font(.system(size: 14))
                                .foregroundColor(Color.white.opacity(0.5))
                            
                            Rectangle()
                                .fill(
                                    LinearGradient(
                                        gradient: Gradient(colors: [Color.purple, Color.pink]),
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    )
                                )
                                .frame(width: 200 * page.dreamIntensity, height: 4)
                                .cornerRadius(2)
                        }
                    }
                    .padding(40)
                    .frame(width: 400, height: 600)
                    .background(
                        RoundedRectangle(cornerRadius: 20)
                            .fill(Color(red: 0.1, green: 0.1, blue: 0.15).opacity(0.6))
                            .overlay(
                                RoundedRectangle(cornerRadius: 20)
                                    .stroke(Color.white.opacity(0.1), lineWidth: 1)
                            )
                    )
                    .rotation3DEffect(
                        .degrees(activePageIndex == index ? 0 : 10),
                        axis: (x: 0, y: 1, z: 0)
                    )
                }
            }
            .padding(.horizontal, 520)
        }
    }
}