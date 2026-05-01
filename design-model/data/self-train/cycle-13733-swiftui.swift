struct ContentView: View {
    @State private var organisms: [TimeOrganism] = []
    @State private var futureTokens: [FutureToken] = []
    @State private var contracts: [NegotiationContract] = []
    @State private var timeline: [CrystallineSegment] = []
    @State private var selectedOrganism: UUID?
    @State private var draggedToken: UUID?
    @State private var contractDraft: String = ""
    @State private var timelineStress: CGFloat = 0
    @State private var currentTime: Date = Date()
    @State private var breathingPhase: CGFloat = 0
    @State private var glowPhase: CGFloat = 0
    
    let timer = Timer.publish(every: 0.016, on: .main, in: .common).autoconnect()
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Dark void background
                Rectangle()
                    .fill(Color(red: 0.02, green: 0.02, blue: 0.04))
                
                // Subtle energy field
                ForEach(0..<3) { layer in
                    Circle()
                        .fill(RadialGradient(
                            colors: [
                                Color(red: 0.1, green: 0.05, blue: 0.15).opacity(0.1),
                                Color.clear
                            ],
                            center: .center,
                            startRadius: 100,
                            endRadius: 400
                        ))
                        .scaleEffect(1 + sin(breathingPhase + CGFloat(layer)) * 0.1)
                        .offset(x: cos(breathingPhase * 0.3 + CGFloat(layer)) * 20)
                }
                
                HStack(spacing: 0) {
                    // Left: Organism habitat
                    ZStack {
                        ForEach(organisms) { organism in
                            OrganismView(
                                organism: organism,
                                isSelected: selectedOrganism == organism.id,
                                breathingPhase: breathingPhase
                            )
                            .position(organism.position)
                            .onTapGesture {
                                withAnimation(.spring(response: 0.4)) {
                                    selectedOrganism = organism.id
                                }
                            }
                        }
                    }
                    .frame(width: geometry.size.width * 0.4)
                    
                    // Center: Negotiation chamber
                    VStack(spacing: 0) {
                        // Contract drafting area
                        if let selected = organisms.first(where: { $0.id == selectedOrganism }) {
                            VStack(spacing: 20) {
                                Text("NEGOTIATING WITH TOMORROW")
                                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                                    .foregroundColor(Color(red: 0.7, green: 0.7, blue: 0.8))
                                    .tracking(3)
                                
                                Text(selected.task)
                                    .font(.system(size: 24, weight: .light, design: .serif))
                                    .foregroundColor(.white)
                                    .multilineTextAlignment(.center)
                                    .padding(.horizontal, 30)
                                
                                // Token trading area
                                ZStack {
                                    RoundedRectangle(cornerRadius: 20)
                                        .fill(Color(red: 0.05, green: 0.05, blue: 0.08))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 20)
                                                .stroke(Color(red: 0.2, green: 0.1, blue: 0.3), lineWidth: 1)
                                        )
                                    
                                    VStack(spacing: 15) {
                                        Text("OFFER TOKENS TO SHRINK")
                                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                                            .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.6))
                                        
                                        HStack(spacing: 15) {
                                            ForEach(futureTokens.filter { !$0.isTraded }) { token in
                                                TokenView(token: token, glowPhase: glowPhase)
                                                    .scaleEffect(draggedToken == token.id ? 1.2 : 1)
                                                    .onDrag {
                                                        draggedToken = token.id
                                                        return NSItemProvider(object: token.id.uuidString as NSString)
                                                    }
                                            }
                                        }
                                    }
                                    .padding(30)
                                }
                                .frame(height: 120)
                                
                                // Contract terms
                                ZStack {
                                    RoundedRectangle(cornerRadius: 15)
                                        .fill(Color(red: 0.03, green: 0.03, blue: 0.05))
                                    
                                    TextEditor(text: $contractDraft)
                                        .font(.system(size: 14, weight: .regular, design: .monospaced))
                                        .foregroundColor(Color(red: 0.8, green: 0.8, blue: 0.9))
                                        .scrollContentBackground(.hidden)
                                        .padding(15)
                                }
                                .frame(height: 100)
                                
                                Button(action: {
                                    if !contractDraft.isEmpty {
                                        let tradedTokens = futureTokens.filter { $0.isTraded }.map { $0.id }
                                        let contract = NegotiationContract(
                                            organismId: selected.id,
                                            terms: contractDraft,
                                            tokenIds: tradedTokens,
                                            timestamp: Date()
                                        )
                                        contracts.append(contract)
                                        
                                        if let index = organisms.firstIndex(where: { $0.id == selected.id }) {
                                            organisms[index].size *= 0.7
                                            organisms[index].urgency *= 0.8
                                        }
                                        
                                        contractDraft = ""
                                        selectedOrganism = nil
                                    }
                                }) {
                                    Text("SEAL CONTRACT")
                                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                                        .foregroundColor(.white)
                                        .padding(.horizontal, 30)
                                        .padding(.vertical, 12)
                                        .background(Color(red: 0.4, green: 0.2, blue: 0.6))
                                        .clipShape(RoundedRectangle(cornerRadius: 25))
                                }
                            }
                            .padding(40)
                        }
                    }
                    .frame(width: geometry.size.width * 0.35)
                    
                    // Right: Timeline crystal
                    ZStack {
                        ForEach(0..<timeline.count, id: \.self) { index in
                            Path { path in
                                let center = CGPoint(x: geometry.size.width * 0.125, y: geometry.size.height * 0.5)
                                let radius = 100.0 + Double(index) * 20.0
                                let segment = timeline[index]
                                
                                path.move(to: center)
                                path.addArc(
                                    center: center,
                                    radius: radius,
                                    startAngle: .degrees(0),
                                    endAngle: .degrees(360),
                                    clockwise: true
                                )
                            }
                            .stroke(
                                Color(red: 0.3, green: 0.5, blue: 0.8).opacity(0.3 - Double(index) * 0.05),
                                lineWidth: 2 + timeline[index].stress * 5
                            )
                        }
                        
                        // Central time indicator
                        Circle()
                            .fill(Color.white)
                            .frame(width: 8, height: 8)
                            .position(x: geometry.size.width * 0.125, y: geometry.size.height * 0.5)
                            .shadow(color: .white, radius: 10)
                    }
                    .frame(width: geometry.size.width * 0.25)
                    
                }
            }
        }
        .onAppear {
            // Initialize with some organisms
            organisms = [
                TimeOrganism(task: "Write report", urgency: 0.8, size: 60, position: CGPoint(x: 150, y: 200), hue: 0.3),
                TimeOrganism(task: "Call mom", urgency: 0.5, size: 45, position: CGPoint(x: 250, y: 350), hue: 0.7),
                TimeOrganism(task: "Exercise", urgency: 0.6, size: 50, position: CGPoint(x: 100, y: 450), hue: 0.5)
            ]
            
            // Initialize future tokens
            futureTokens = [
                FutureToken(type: "FOCUS", value: 2.0),
                FutureToken(type: "ENERGY", value: 1.5),
                FutureToken(type: "TIME", value: 3.0),
                FutureToken(type: "PEACE", value: 2.5)
            ]
            
            // Initialize timeline
            for i in 0..<5 {
                timeline.append(CrystallineSegment(
                    time: Date().addingTimeInterval(Double(i) * 3600),
                    stress: CGFloat.random(in: 0.1...0.5),
                    contracts: []
                ))
            }
        }
        .onReceive(timer) { _ in
            withAnimation(.linear(duration: 0.016)) {
                breathingPhase += 0.02
                glowPhase += 0.03
                
                // Update organism urgency
                for index in organisms.indices {
                    organisms[index].urgency = min(organisms[index].urgency + 0.001, 1.0)
                    organisms[index].size = min(organisms[index].size + 0.05, 80)
                }
            }
        }
        .onDrop(of: [.text], isTargeted: nil) { providers in
            _ = providers
            if let tokenId = draggedToken,
               let index = futureTokens.firstIndex(where: { $0.id == tokenId }) {
                futureTokens[index].isTraded = true
                draggedToken = nil
            }
            return true
        }
    }
}