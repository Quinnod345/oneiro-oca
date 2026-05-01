struct ContentView: View {
    @State private var shards: [DreamShard] = []
    @State private var connections: [ShardConnection] = []
    @State private var draggedShard: UUID?
    @State private var hoveredShard: UUID?
    @State private var currentTime: Date = Date()
    @State private var narrativeScore: Double = 0
    @State private var capturePhase: Bool = true
    
    let dreamFragments = [
        ("whispered", Color(red: 0.4, green: 0.3, blue: 0.6)),
        ("falling", Color(red: 0.6, green: 0.2, blue: 0.3)),
        ("mother", Color(red: 0.8, green: 0.7, blue: 0.9)),
        ("teeth", Color(red: 0.9, green: 0.9, blue: 0.8)),
        ("ocean", Color(red: 0.2, green: 0.4, blue: 0.6)),
        ("burning", Color(red: 0.9, green: 0.3, blue: 0.2)),
        ("childhood", Color(red: 0.9, green: 0.8, blue: 0.6)),
        ("mirror", Color(red: 0.7, green: 0.7, blue: 0.8)),
        ("running", Color(red: 0.3, green: 0.6, blue: 0.3)),
        ("forgotten", Color(red: 0.5, green: 0.5, blue: 0.6))
    ]
    
    let semanticRelations: [String: [String: Bool]] = [
        "falling": ["ocean": false, "burning": true, "running": false],
        "mother": ["childhood": false, "forgotten": true, "mirror": false],
        "teeth": ["mirror": false, "falling": true, "burning": false],
        "ocean": ["burning": true, "childhood": false, "whispered": false],
        "mirror": ["forgotten": false, "childhood": true, "mother": false]
    ]
    
    var body: some View {
        ZStack {
            Color(red: 0.03, green: 0.02, blue: 0.05)
                .ignoresSafeArea()
            
            ForEach(connections, id: \.id) { connection in
                if let fromShard = shards.first(where: { $0.id == connection.from }),
                   let toShard = shards.first(where: { $0.id == connection.to }) {
                    Path { path in
                        path.move(to: fromShard.position)
                        let control = CGPoint(
                            x: (fromShard.position.x + toShard.position.x) / 2,
                            y: (fromShard.position.y + toShard.position.y) / 2 - 50
                        )
                        path.addQuadCurve(to: toShard.position, control: control)
                    }
                    .stroke(
                        connection.repels ? 
                        Color(red: 0.8, green: 0.2, blue: 0.3) : 
                        Color(red: 0.3, green: 0.6, blue: 0.9),
                        style: StrokeStyle(
                            lineWidth: 1.5 * connection.strength,
                            lineCap: .round,
                            dash: connection.repels ? [5, 10] : []
                        )
                    )
                    .opacity(0.4)
                }
            }
            
            ForEach(shards.indices, id: \.self) { index in
                ShardView(
                    shard: $shards[index],
                    isDragged: draggedShard == shards[index].id,
                    isHovered: hoveredShard == shards[index].id
                )
                .offset(
                    x: shards[index].position.x - 720,
                    y: shards[index].position.y - 450
                )
                .onHover { hovering in
                    hoveredShard = hovering ? shards[index].id : nil
                }
                .onDrag {
                    draggedShard = shards[index].id
                    return NSItemProvider(object: shards[index].id.uuidString as NSString)
                }
                .onDrop(of: [.text], delegate: ShardDropDelegate(
                    targetShard: shards[index],
                    shards: $shards,
                    connections: $connections,
                    semanticRelations: semanticRelations
                ))
            }
            
            VStack {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("DREAM RESIDUE")
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundColor(Color(red: 0.6, green: 0.6, blue: 0.7))
                            .tracking(2)
                        
                        Text("Fragments dissolving in \(Int(max(0, 120 - currentTime.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 120))))s")
                            .font(.system(size: 13, weight: .light, design: .default))
                            .foregroundColor(Color(red: 0.4, green: 0.4, blue: 0.5))
                    }
                    
                    Spacer()
                    
                    if narrativeScore > 0.3 {
                        Text("COHERENCE: \(Int(narrativeScore * 100))%")
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .foregroundColor(Color(red: 0.3, green: 0.8, blue: 0.6))
                            .opacity(narrativeScore)
                    }
                }
                .padding(.horizontal, 40)
                .padding(.top, 30)
                
                Spacer()
                
                if capturePhase {
                    Button(action: captureNewFragment) {
                        HStack(spacing: 12) {
                            Circle()
                                .fill(Color(red: 0.9, green: 0.2, blue: 0.3))
                                .frame(width: 8, height: 8)
                                .opacity(0.8)
                            
                            Text("CAPTURE FRAGMENT")
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .foregroundColor(Color(red: 0.8, green: 0.8, blue: 0.9))
                                .tracking(1.5)
                        }
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .background(
                            RoundedRectangle(cornerRadius: 20)
                                .fill(Color.white.opacity(0.1))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 20)
                                .stroke(Color.white.opacity(0.2), lineWidth: 1)
                        )
                    }
                    .padding(.bottom, 40)
                }
            }
        }
        .onAppear {
            startDreamCapture()
        }
    }
    
    func captureNewFragment() {
        guard let fragment = dreamFragments.randomElement() else { return }
        
        let newShard = DreamShard(
            word: fragment.0,
            position: CGPoint(
                x: Double.random(in: 100...1340),
                y: Double.random(in: 100...800)
            ),
            color: fragment.1,
            intensity: 1.0,
            fadeTimer: 120
        )
        
        shards.append(newShard)
        updateNarrativeScore()
    }
    
    func startDreamCapture() {
        Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
            currentTime = Date()
            
            for index in shards.indices {
                shards[index].fadeTimer -= 0.1
                shards[index].intensity = max(0, shards[index].fadeTimer / 120)
            }
            
            shards.removeAll { $0.fadeTimer <= 0 }
            connections.removeAll { connection in
                !shards.contains { $0.id == connection.from || $0.id == connection.to }
            }
            
            if Int(currentTime.timeIntervalSinceReferenceDate) % 8 == 0 && capturePhase {
                captureNewFragment()
            }
        }
    }
    
    func updateNarrativeScore() {
        let connectionCount = Double(connections.count)
        let shardCount = Double(shards.count)
        
        if shardCount > 0 {
            narrativeScore = min(1.0, connectionCount / (shardCount * 0.5))
        } else {
            narrativeScore = 0
        }
    }
}