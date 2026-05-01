struct ContentView: View {
    @State private var rooms: [Room] = [
        Room(name: "Study", position: CGPoint(x: 320, y: 250), size: CGSize(width: 180, height: 140)),
        Room(name: "Kitchen", position: CGPoint(x: 550, y: 280), size: CGSize(width: 160, height: 160)),
        Room(name: "Bedroom", position: CGPoint(x: 780, y: 300), size: CGSize(width: 200, height: 150)),
        Room(name: "Living", position: CGPoint(x: 450, y: 450), size: CGSize(width: 220, height: 180)),
        Room(name: "Library", position: CGPoint(x: 250, y: 480), size: CGSize(width: 150, height: 120)),
        Room(name: "Garden", position: CGPoint(x: 700, y: 500), size: CGSize(width: 180, height: 140))
    ]
    
    @State private var buildingState: EmotionalState = EmotionalState()
    @State private var hoveredRoom: UUID?
    @State private var selectedRoom: UUID?
    @State private var schedule: [ActivitySchedule] = []
    @State private var timeElapsed: TimeInterval = 0
    
    let timer = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()
            
            // Neural connections layer
            Canvas { context, size in
                for i in 0..<rooms.count {
                    for j in (i+1)..<rooms.count {
                        let room1 = rooms[i]
                        let room2 = rooms[j]
                        let distance = hypot(room1.position.x - room2.position.x, room1.position.y - room2.position.y)
                        
                        if distance < 300 {
                            let opacity = (1 - distance / 300) * 0.15 * buildingState.intensity
                            let path = Path { p in
                                p.move(to: room1.position)
                                p.addLine(to: room2.position)
                            }
                            
                            context.stroke(
                                path,
                                with: .color(buildingState.mood.color.opacity(opacity)),
                                lineWidth: 1
                            )
                        }
                    }
                }
            }
            
            VStack(spacing: 40) {
                // Header
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("BUILDING STATE")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.gray)
                            .tracking(1.5)
                        
                        Text(moodDescription)
                            .font(.system(size: 28, weight: .light))
                            .foregroundColor(.white)
                    }
                    
                    Spacer()
                    
                    HStack(spacing: 24) {
                        ForEach(["Stability", "Intensity", "Harmony"], id: \.self) { metric in
                            VStack(alignment: .trailing, spacing: 4) {
                                Text(metric.uppercased())
                                    .font(.system(size: 9, weight: .semibold))
                                    .foregroundColor(.gray)
                                
                                Text(String(format: "%.0f%%", metricValue(for: metric) * 100))
                                    .font(.system(size: 16, weight: .light))
                                    .foregroundColor(buildingState.mood.color)
                            }
                        }
                    }
                }
                .padding(.horizontal, 40)
                .padding(.top, 40)
                
                // Floor plan
                ZStack {
                    ForEach(rooms) { room in
                        RoomView(
                            room: room,
                            isHovered: hoveredRoom == room.id,
                            isSelected: selectedRoom == room.id,
                            buildingState: buildingState,
                            timeElapsed: timeElapsed
                        )
                        .onHover { isHovered in
                            withAnimation(.easeOut(duration: 0.2)) {
                                hoveredRoom = isHovered ? room.id : nil
                            }
                        }
                        .onTapGesture {
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                                if selectedRoom == room.id {
                                    selectedRoom = nil
                                } else {
                                    selectedRoom = room.id
                                    updateBuildingState()
                                }
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                
                Spacer()
            }
        }
        .onReceive(timer) { _ in
            timeElapsed += 0.05
            if Int(timeElapsed) % 10 == 0 {
                evolveSchedule()
            }
        }
    }
    
    var moodDescription: String {
        switch buildingState.mood {
        case .calm: return "Calm"
        case .active: return "Active"
        case .contemplative: return "Contemplative"
        case .social: return "Social"
        }
    }
    
    func metricValue(for metric: String) -> Double {
        switch metric {
        case "Stability":
            return 1.0 - buildingState.volatility
        case "Intensity":
            return buildingState.intensity
        case "Harmony":
            return buildingState.coherence
        default:
            return 0.5
        }
    }
    
    func updateBuildingState() {
        buildingState.intensity = Double.random(in: 0.4...0.9)
        buildingState.coherence = Double.random(in: 0.5...1.0)
        buildingState.volatility = Double.random(in: 0...0.3)
        buildingState.mood = Mood.allCases.randomElement()!
    }
    
    func evolveSchedule() {
        schedule = rooms.map { room in
            ActivitySchedule(
                roomId: room.id,
                activity: ["Working", "Resting", "Meeting", "Creating"].randomElement()!,
                startTime: Date().addingTimeInterval(Double.random(in: 0...3600)),
                duration: Double.random(in: 900...3600)
            )
        }
    }
}

struct RoomView: View {
    let room: Room
    let isHovered: Bool
    let isSelected: Bool
    let buildingState: EmotionalState
    let timeElapsed: TimeInterval
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 2)
                .stroke(
                    buildingState.mood.color.opacity(isSelected ? 1 : (isHovered ? 0.8 : 0.4)),
                    lineWidth: isSelected ? 2 : 1
                )
                .background(
                    RoundedRectangle(cornerRadius: 2)
                        .fill(buildingState.mood.color.opacity(isSelected ? 0.1 : 0))
                )
                .frame(width: room.size.width, height: room.size.height)
                .scaleEffect(isHovered ? 1.05 : 1)
            
            Text(room.name.uppercased())
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.white.opacity(isHovered ? 1 : 0.6))
                .tracking(1)
        }
        .position(room.position)
    }
}

struct Room: Identifiable {
    let id = UUID()
    let name: String
    var position: CGPoint
    var size: CGSize
}

struct EmotionalState {
    var mood: Mood = .calm
    var intensity: Double = 0.5
    var coherence: Double = 0.8
    var volatility: Double = 0.2
}

enum Mood: CaseIterable {
    case calm, active, contemplative, social
    
    var color: Color {
        switch self {
        case .calm: return Color.cyan
        case .active: return Color.orange
        case .contemplative: return Color.purple
        case .social: return Color.green
        }
    }
}

struct ActivitySchedule {
    let roomId: UUID
    let activity: String
    let startTime: Date
    let duration: TimeInterval
}