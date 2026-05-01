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
    @State private var wallThickness: Double = 2.0
    @State private var breathingSpeed: Double = 2.0
    @State private var connectionOpacity: Double = 0.3
    @State private var timeElapsed: TimeInterval = 0
    
    let timer = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()
    
    var moodDescription: String {
        switch buildingState.mood {
        case .calm: return "Tranquil Flow"
        case .energized: return "Vibrant Pulse"
        case .contemplative: return "Deep Reflection"
        case .creative: return "Inspired Movement"
        case .restless: return "Seeking Balance"
        }
    }
    
    func metricValue(for metric: String) -> Double {
        switch metric {
        case "Stability": return buildingState.stability
        case "Intensity": return buildingState.intensity
        case "Harmony": return buildingState.harmony
        default: return 0.5
        }
    }
    
    var body: some View {
        ZStack {
            // Breathing background
            Canvas { context, size in
                let phase = sin(timeElapsed * breathingSpeed * 0.5)
                let gradient = Gradient(colors: [
                    buildingState.mood.color.opacity(0.05),
                    buildingState.mood.color.opacity(0.1 + phase * 0.05),
                    Color.clear
                ])
                
                for i in 0..<3 {
                    let center = CGPoint(
                        x: size.width * (0.3 + Double(i) * 0.2),
                        y: size.height * (0.4 + sin(timeElapsed * 0.3 + Double(i)) * 0.1)
                    )
                    let radius = 300 + phase * 50 * buildingState.intensity
                    
                    context.drawLayer { ctx in
                        ctx.fill(
                            Path(ellipseIn: CGRect(
                                x: center.x - radius,
                                y: center.y - radius,
                                width: radius * 2,
                                height: radius * 2
                            )),
                            with: .radialGradient(
                                gradient,
                                center: center,
                                startRadius: 0,
                                endRadius: radius
                            )
                        )
                    }
                }
            }
            .ignoresSafeArea()
            
            VStack(spacing: 0) {
                // Emotional status header
                HStack(spacing: 40) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("BUILDING CONSCIOUSNESS")
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundColor(Color.gray)
                            .tracking(2)
                        
                        HStack(spacing: 16) {
                            Text(moodDescription)
                                .font(.system(size: 24, weight: .light, design: .serif))
                                .foregroundColor(buildingState.mood.color)
                            
                            Circle()
                                .fill(buildingState.mood.color)
                                .frame(width: 12, height: 12)
                                .scaleEffect(1 + sin(timeElapsed * 3) * 0.2)
                                .blur(radius: buildingState.intensity > 0.7 ? 2 : 0)
                        }
                    }
                    
                    Spacer()
                    
                    VStack(alignment: .trailing, spacing: 12) {
                        ForEach(["Stability", "Intensity", "Harmony"], id: \.self) { metric in
                            HStack(spacing: 8) {
                                Text(metric)
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundColor(Color.gray)
                                
                                ZStack(alignment: .leading) {
                                    Capsule()
                                        .fill(Color.gray.opacity(0.1))
                                        .frame(width: 120, height: 4)
                                    
                                    Capsule()
                                        .fill(buildingState.mood.color.opacity(0.7))
                                        .frame(width: 120 * metricValue(for: metric), height: 4)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 60)
                .padding(.vertical, 30)
                
                // Living blueprint
                ZStack {
                    // Neural connections between rooms
                    Canvas { context, size in
                        for i in 0..<rooms.count {
                            for j in (i+1)..<rooms.count {
                                let room1 = rooms[i]
                                let room2 = rooms[j]
                                
                                let distance = sqrt(pow(room1.position.x - room2.position.x, 2) + pow(room1.position.y - room2.position.y, 2))
                                if distance < 300 {
                                    let path = Path { p in
                                        p.move(to: room1.position)
                                        
                                        let control1 = CGPoint(
                                            x: room1.position.x + (room2.position.x - room1.position.x) * 0.5,
                                            y: room1.position.y - 20
                                        )
                                        let control2 = CGPoint(
                                            x: room2.position.x - (room2.position.x - room1.position.x) * 0.5,
                                            y: room2.position.y + 20
                                        )
                                        
                                        p.addCurve(to: room2.position, control1: control1, control2: control2)
                                    }
                                    
                                    context.stroke(
                                        path,
                                        with: .color(buildingState.mood.color.opacity(connectionOpacity * (1 - distance / 300))),
                                        lineWidth: 1 + sin(timeElapsed * 2 + Double(i + j)) * 0.5
                                    )
                                }
                            }
                        }
                    }
                    
                    // Rooms
                    ForEach(rooms) { room in
                        RoomView(
                            room: room,
                            isHovered: hoveredRoom == room.id,
                            isSelected: selectedRoom == room.id,
                            wallThickness: wallThickness,
                            moodColor: buildingState.mood.color,
                            timeElapsed: timeElapsed
                        )
                        .position(room.position)
                        .onHover { isHovered in
                            hoveredRoom = isHovered ? room.id : nil
                        }
                        .onTapGesture {
                            selectedRoom = selectedRoom == room.id ? nil : room.id
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black.opacity(0.02))
                
                // Controls
                HStack(spacing: 40) {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("BUILDING PARAMETERS")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundColor(Color.gray)
                            .tracking(1.5)
                        
                        HStack(spacing: 24) {
                            ParameterSlider(
                                label: "Wall Thickness",
                                value: $wallThickness,
                                range: 0.5...5.0
                            )
                            
                            ParameterSlider(
                                label: "Breathing Speed",
                                value: $breathingSpeed,
                                range: 0.5...5.0
                            )
                            
                            ParameterSlider(
                                label: "Connection Opacity",
                                value: $connectionOpacity,
                                range: 0.0...1.0
                            )
                        }
                    }
                    
                    Spacer()
                    
                    HStack(spacing: 16) {
                        ForEach([Mood.calm, .energized, .contemplative, .creative, .restless], id: \.self) { mood in
                            MoodButton(
                                mood: mood,
                                isSelected: buildingState.mood == mood,
                                action: { buildingState.mood = mood }
                            )
                        }
                    }
                }
                .padding(.horizontal, 60)
                .padding(.vertical, 30)
            }
        }
        .onReceive(timer) { _ in
            timeElapsed += 0.1
            updateBuildingState()
        }
    }
    
    func updateBuildingState() {
        // Simulate dynamic changes
        buildingState.intensity = 0.5 + sin(timeElapsed * 0.2) * 0.3
        buildingState.stability = 0.7 + cos(timeElapsed * 0.15) * 0.2
        buildingState.harmony = 0.8 + sin(timeElapsed * 0.1 + 1.5) * 0.15
    }
}

struct RoomView: View {
    let room: Room
    let isHovered: Bool
    let isSelected: Bool
    let wallThickness: Double
    let moodColor: Color
    let timeElapsed: TimeInterval
    
    var body: some View {
        ZStack {
            // Room outline
            RoundedRectangle(cornerRadius: 8)
                .stroke(
                    moodColor.opacity(isSelected ? 0.8 : 0.3),
                    lineWidth: wallThickness * (isHovered ? 1.5 : 1.0)
                )
                .frame(width: room.size.width, height: room.size.height)
                .scaleEffect(1 + sin(timeElapsed * 2 + room.position.x * 0.01) * 0.02)
            
            // Room fill
            RoundedRectangle(cornerRadius: 8)
                .fill(moodColor.opacity(isSelected ? 0.1 : 0.02))
                .frame(width: room.size.width, height: room.size.height)
            
            // Room name
            Text(room.name)
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundColor(moodColor.opacity(0.8))
                .scaleEffect(isHovered ? 1.1 : 1.0)
                .animation(.easeInOut(duration: 0.2), value: isHovered)
        }
    }
}

struct ParameterSlider: View {
    let label: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(Color.gray)
            
            Slider(value: $value, in: range)
                .frame(width: 120)
                .accentColor(Color.gray)
        }
    }
}

struct MoodButton: View {
    let mood: Mood
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            Circle()
                .fill(mood.color.opacity(isSelected ? 0.8 : 0.3))
                .frame(width: 30, height: 30)
                .overlay(
                    Circle()
                        .stroke(mood.color, lineWidth: isSelected ? 2 : 1)
                )
        }
    }
}