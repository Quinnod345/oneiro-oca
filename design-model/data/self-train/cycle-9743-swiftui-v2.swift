struct ContentView: View {
    @State private var shards: [DreamShard] = []
    @State private var connections: [ShardConnection] = []
    @State private var draggedShard: UUID?
    @State private var hoveredShard: UUID?
    @State private var currentTime: Date = Date()
    @State private var narrativeScore: Double = 0
    @State private var capturePhase: Bool = true
    
    let dreamFragments = [
        ("whispered", Color(red: 0.4, green: 0.5, blue: 0.7)),
        ("falling", Color(red: 0.35, green: 0.4, blue: 0.65)),
        ("mother", Color(red: 0.45, green: 0.5, blue: 0.75)),
        ("teeth", Color(red: 0.5, green: 0.55, blue: 0.8)),
        ("ocean", Color(red: 0.3, green: 0.45, blue: 0.7)),
        ("burning", Color(red: 0.4, green: 0.35, blue: 0.6)),
        ("childhood", Color(red: 0.5, green: 0.6, blue: 0.85)),
        ("mirror", Color(red: 0.4, green: 0.5, blue: 0.8)),
        ("running", Color(red: 0.35, green: 0.5, blue: 0.75)),
        ("forgotten", Color(red: 0.3, green: 0.4, blue: 0.6))
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
            LinearGradient(
                gradient: Gradient(colors: [
                    Color(red: 0.05, green: 0.08, blue: 0.15),
                    Color(red: 0.02, green: 0.03, blue: 0.08)
                ]),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            
            ForEach(connections, id: \.from) { connection in
                if let fromShard = shards.first(where: { $0.id == connection.from }),
                   let toShard = shards.first(where: { $0.id == connection.to }) {
                    ConnectionView(
                        from: fromShard.position,
                        to: toShard.position,
                        strength: connection.strength,
                        repels: connection.repels
                    )
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
                    VStack(alignment: .leading, spacing: 8) {
                        Text("DREAM RESIDUE")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.white.opacity(0.9))
                        
                        Text("Fragments dissolving in \(Int(max(0, 120 - currentTime.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 120))))s")
                            .font(.system(size: 16, weight: .regular))
                            .foregroundColor(.white.opacity(0.6))
                    }
                    .padding()
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(.ultraThinMaterial)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .strokeBorder(.white.opacity(0.1), lineWidth: 1)
                            )
                    )
                    
                    Spacer()
                    
                    if narrativeScore > 0.3 {
                        HStack(spacing: 12) {
                            Circle()
                                .fill(.white.opacity(0.8))
                                .frame(width: 8, height: 8)
                                .overlay(
                                    Circle()
                                        .fill(.white.opacity(0.3))
                                        .frame(width: 16, height: 16)
                                        .blur(radius: 4)
                                )
                            
                            Text("COHERENCE \(Int(narrativeScore * 100))%")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(.white.opacity(0.9))
                        }
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)
                        .background(
                            Capsule()
                                .fill(.ultraThinMaterial)
                                .overlay(
                                    Capsule()
                                        .strokeBorder(.white.opacity(0.15), lineWidth: 1)
                                )
                        )
                    }
                }
                .padding()
                
                Spacer()
                
                HStack(spacing: 4) {
                    ForEach(0..<5) { i in
                        Circle()
                            .fill(.white.opacity(capturePhase ? 0.2 : 0.6))
                            .frame(width: 6, height: 6)
                            .scaleEffect(capturePhase ? 1 : 1.2)
                            .animation(
                                .easeInOut(duration: 1.5)
                                .delay(Double(i) * 0.1)
                                .repeatForever(autoreverses: true),
                                value: capturePhase
                            )
                    }
                }
                .padding()
            }
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
                currentTime = Date()
                updateShardPhysics()
                if Double.random(in: 0...1) < 0.02 && shards.count < 12 {
                    addRandomShard()
                }
            }
        }
    }
    
    func updateShardPhysics() {
        for i in shards.indices {
            shards[i].luminosity = max(0.3, shards[i].luminosity * 0.995)
            
            var force = CGPoint.zero
            for j in shards.indices where i != j {
                let dx = shards[j].position.x - shards[i].position.x
                let dy = shards[j].position.y - shards[i].position.y
                let distance = sqrt(dx * dx + dy * dy)
                
                if distance > 20 && distance < 300 {
                    let magnitude = 200 / (distance * distance)
                    force.x -= dx * magnitude
                    force.y -= dy * magnitude
                }
            }
            
            shards[i].position.x += force.x * 0.01
            shards[i].position.y += force.y * 0.01
            
            shards[i].position.x = max(100, min(1340, shards[i].position.x))
            shards[i].position.y = max(100, min(800, shards[i].position.y))
        }
    }
    
    func addRandomShard() {
        let fragment = dreamFragments.randomElement()!
        let newShard = DreamShard(
            word: fragment.0,
            color: fragment.1,
            position: CGPoint(
                x: CGFloat.random(in: 200...1240),
                y: CGFloat.random(in: 200...700)
            ),
            luminosity: 1.0
        )
        
        shards.append(newShard)
        
        for existing in shards where existing.id != newShard.id {
            if let relation = semanticRelations[fragment.0]?[existing.word] {
                connections.append(ShardConnection(
                    from: newShard.id,
                    to: existing.id,
                    strength: CGFloat.random(in: 0.5...1.0),
                    repels: relation
                ))
                narrativeScore = min(1.0, narrativeScore + (relation ? -0.05 : 0.1))
            }
        }
    }
}

struct ConnectionView: View {
    let from: CGPoint
    let to: CGPoint
    let strength: CGFloat
    let repels: Bool
    
    @State private var particlePhase: Double = 0
    
    var body: some View {
        ZStack {
            Path { path in
                path.move(to: from)
                let control = CGPoint(
                    x: (from.x + to.x) / 2,
                    y: (from.y + to.y) / 2 - 30
                )
                path.addQuadCurve(to: to, control: control)
            }
            .stroke(
                LinearGradient(
                    gradient: Gradient(colors: [
                        Color.white.opacity(repels ? 0.1 : 0.2),
                        Color.white.opacity(0.05)
                    ]),
                    startPoint: .leading,
                    endPoint: .trailing
                ),
                style: StrokeStyle(lineWidth: strength, lineCap: .round)
            )
            .blur(radius: 1)
            
            if !repels {
                ForEach(0..<3) { i in
                    Circle()
                        .fill(Color.white.opacity(0.4))
                        .frame(width: 4, height: 4)
                        .blur(radius: 1)
                        .offset(x: interpolatePosition(t: particlePhase + Double(i) * 0.33).x - 720,
                               y: interpolatePosition(t: particlePhase + Double(i) * 0.33).y - 450)
                }
            }
        }
        .onAppear {
            withAnimation(.linear(duration: 4).repeatForever(autoreverses: false)) {
                particlePhase = 1
            }
        }
    }
    
    func interpolatePosition(t: Double) -> CGPoint {
        let t = t.truncatingRemainder(dividingBy: 1)
        let control = CGPoint(
            x: (from.x + to.x) / 2,
            y: (from.y + to.y) / 2 - 30
        )
        
        let x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * control.x + t * t * to.x
        let y = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * control.y + t * t * to.y
        
        return CGPoint(x: x, y: y)
    }
}

struct ShardView: View {
    @Binding var shard: DreamShard
    let isDragged: Bool
    let isHovered: Bool
    
    var body: some View {
        Text(shard.word)
            .font(.system(size: 16, weight: .medium))
            .foregroundColor(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(shard.color.opacity(0.2))
                        .blur(radius: 20)
                        .scaleEffect(1.5)
                    
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.ultraThinMaterial)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .strokeBorder(
                                    LinearGradient(
                                        gradient: Gradient(colors: [
                                            shard.color.opacity(0.6),
                                            shard.color.opacity(0.2)
                                        ]),
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    ),
                                    lineWidth: 1
                                )
                        )
                }
            )
            .scaleEffect(isDragged ? 1.1 : (isHovered ? 1.05 : 1))
            .shadow(color: shard.color.opacity(shard.luminosity * 0.5), radius: 10)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isDragged)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovered)
    }
}

struct DreamShard: Identifiable {
    let id = UUID()
    let word: String
    let color: Color
    var position: CGPoint
    var luminosity: Double
}

struct ShardConnection {
    let from: UUID
    let to: UUID
    let strength: CGFloat
    let repels: Bool
}

struct ShardDropDelegate: DropDelegate {
    let targetShard: DreamShard
    @Binding var shards: [DreamShard]
    @Binding var connections: [ShardConnection]
    let semanticRelations: [String: [String: Bool]]
    
    func performDrop(info: DropInfo) -> Bool {
        return true
    }
}