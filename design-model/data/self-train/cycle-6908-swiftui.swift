struct ContentView: View {
    @State private var buildingMood: CGFloat = 0.5
    @State private var rooms: [SentientRoom] = []
    @State private var veins: [EnergyVein] = []
    @State private var vitalSigns: [BuildingVitalSign] = []
    @State private var sliders: [GhostlySlider] = []
    @State private var blueprintOpacity: CGFloat = 0.7
    @State private var organicOpacity: CGFloat = 0.3
    @State private var breathingPhase: CGFloat = 0
    @State private var heartbeatPhase: CGFloat = 0
    @State private var harmonyLevel: CGFloat = 0
    @State private var hiddenChamberRevealed: Bool = false
    @State private var activeSliderID: UUID?
    
    init() {
        _rooms = State(initialValue: [
            SentientRoom(position: CGPoint(x: 400, y: 300), size: CGSize(width: 180, height: 140), comfort: 0.5, pulseFactor: 1.0),
            SentientRoom(position: CGPoint(x: 700, y: 250), size: CGSize(width: 220, height: 160), comfort: 0.6, pulseFactor: 1.0),
            SentientRoom(position: CGPoint(x: 550, y: 500), size: CGSize(width: 200, height: 120), comfort: 0.4, pulseFactor: 1.0),
            SentientRoom(position: CGPoint(x: 900, y: 450), size: CGSize(width: 150, height: 180), comfort: 0.7, pulseFactor: 1.0)
        ])
        
        _veins = State(initialValue: [
            EnergyVein(path: [CGPoint(x: 100, y: 200), CGPoint(x: 400, y: 300), CGPoint(x: 700, y: 250)], flow: 0.5, thickness: 3),
            EnergyVein(path: [CGPoint(x: 200, y: 600), CGPoint(x: 550, y: 500), CGPoint(x: 900, y: 450)], flow: 0.6, thickness: 4),
            EnergyVein(path: [CGPoint(x: 1200, y: 100), CGPoint(x: 900, y: 300), CGPoint(x: 700, y: 500)], flow: 0.4, thickness: 2.5)
        ])
        
        _vitalSigns = State(initialValue: [
            BuildingVitalSign(type: "Structural Tension", value: 0.5, isStable: true),
            BuildingVitalSign(type: "Atmospheric Pressure", value: 0.6, isStable: false),
            BuildingVitalSign(type: "Vibrational Harmony", value: 0.4, isStable: true),
            BuildingVitalSign(type: "Thermal Comfort", value: 0.7, isStable: false)
        ])
        
        _sliders = State(initialValue: [
            GhostlySlider(surface: "Light Angles", position: CGPoint(x: 200, y: 150), value: 0.5, isActive: false),
            GhostlySlider(surface: "Air Pressure", position: CGPoint(x: 1100, y: 200), value: 0.6, isActive: false),
            GhostlySlider(surface: "Vibrations", position: CGPoint(x: 300, y: 700), value: 0.4, isActive: false)
        ])
    }
    
    var body: some View {
        ZStack {
            Color(red: 0.05, green: 0.04, blue: 0.06)
                .ignoresSafeArea()
            
            TimelineView(.animation) { timeline in
                ZStack {
                    // Organic tissue layer
                    Canvas { context, size in
                        let time = timeline.date.timeIntervalSinceReferenceDate
                        
                        // Pulsing organic background
                        for room in rooms {
                            let pulse = sin(time * 2 + Double(room.position.x) * 0.01) * 0.1 + 0.9
                            let expandedSize = CGSize(
                                width: room.size.width * room.pulseFactor * pulse,
                                height: room.size.height * room.pulseFactor * pulse
                            )
                            
                            let rect = CGRect(
                                x: room.position.x - expandedSize.width / 2,
                                y: room.position.y - expandedSize.height / 2,
                                width: expandedSize.width,
                                height: expandedSize.height
                            )
                            
                            context.fill(
                                RoundedRectangle(cornerRadius: 20 * room.comfort).path(in: rect),
                                with: .color(Color(
                                    red: 0.8 * room.comfort,
                                    green: 0.2 + 0.3 * room.comfort,
                                    blue: 0.3
                                ).opacity(organicOpacity))
                            )
                        }
                        
                        // Energy veins
                        for vein in veins {
                            var path = Path()
                            if let first = vein.path.first {
                                path.move(to: first)
                                for point in vein.path.dropFirst() {
                                    path.addLine(to: point)
                                }
                            }
                            
                            let flowOffset = time * vein.flow * 100
                            context.stroke(
                                path,
                                with: .linearGradient(
                                    Gradient(colors: [
                                        Color(red: 0.9, green: 0.3, blue: 0.4).opacity(0),
                                        Color(red: 0.9, green: 0.5, blue: 0.6),
                                        Color(red: 0.9, green: 0.3, blue: 0.4).opacity(0)
                                    ]),
                                    startPoint: CGPoint(x: flowOffset.truncatingRemainder(dividingBy: 200), y: 0),
                                    endPoint: CGPoint(x: flowOffset.truncatingRemainder(dividingBy: 200) + 100, y: 0)
                                ),
                                style: StrokeStyle(lineWidth: vein.thickness * (1 + sin(time * 3) * 0.2))
                            )
                        }
                    }
                    .opacity(0.6)
                    
                    // Blueprint layer
                    Canvas { context, size in
                        // Technical grid
                        let gridSpacing: CGFloat = 50
                        for x in stride(from: 0, through: size.width, by: gridSpacing) {
                            context.stroke(
                                Path { path in
                                    path.move(to: CGPoint(x: x, y: 0))
                                    path.addLine(to: CGPoint(x: x, y: size.height))
                                },
                                with: .color(Color.blue.opacity(0.1)),
                                style: StrokeStyle(lineWidth: 0.5)
                            )
                        }
                        
                        for y in stride(from: 0, through: size.height, by: gridSpacing) {
                            context.stroke(
                                Path { path in
                                    path.move(to: CGPoint(x: 0, y: y))
                                    path.addLine(to: CGPoint(x: size.width, y: y))
                                },
                                with: .color(Color.blue.opacity(0.1)),
                                style: StrokeStyle(lineWidth: 0.5)
                            )
                        }
                        
                        // Room blueprints
                        for room in rooms {
                            let rect = CGRect(
                                x: room.position.x - room.size.width / 2,
                                y: room.position.y - room.size.height / 2,
                                width: room.size.width,
                                height: room.size.height
                            )
                            
                            context.stroke(
                                Rectangle().path(in: rect),
                                with: .color(Color.blue),
                                style: StrokeStyle(lineWidth: 1, dash: [5, 3])
                            )
                        }
                    }
                    .opacity(blueprintOpacity)
                    
                    // Interactive elements
                    ForEach(sliders, id: \.id) { slider in
                        VStack {
                            Text(slider.surface)
                                .font(.caption)
                                .foregroundColor(.white.opacity(0.7))
                            
                            ZStack {
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(Color.white.opacity(0.1))
                                    .frame(width: 150, height: 30)
                                
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(Color.blue.opacity(0.5))
                                    .frame(width: 150 * slider.value, height: 26)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 2)
                            }
                        }
                        .position(slider.position)
                    }
                    
                    // Vital signs display
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Building Vital Signs")
                            .font(.headline)
                            .foregroundColor(.white)
                        
                        ForEach(vitalSigns, id: \.id) { sign in
                            HStack {
                                Circle()
                                    .fill(sign.isStable ? Color.green : Color.orange)
                                    .frame(width: 8, height: 8)
                                
                                Text(sign.type)
                                    .font(.caption)
                                    .foregroundColor(.white.opacity(0.8))
                                
                                Spacer()
                                
                                Text(String(format: "%.0f%%", sign.value * 100))
                                    .font(.caption.monospaced())
                                    .foregroundColor(.white.opacity(0.6))
                            }
                            .frame(width: 200)
                        }
                    }
                    .padding()
                    .background(Color.black.opacity(0.5))
                    .cornerRadius(10)
                    .position(x: 150, y: 400)
                    
                    // Hidden chamber (revealed based on harmony)
                    if hiddenChamberRevealed {
                        Circle()
                            .fill(
                                RadialGradient(
                                    colors: [Color.purple.opacity(0.6), Color.clear],
                                    center: .center,
                                    startRadius: 0,
                                    endRadius: 100
                                )
                            )
                            .frame(width: 200, height: 200)
                            .position(x: 650, y: 350)
                            .transition(.opacity.combined(with: .scale))
                    }
                }
                .onChange(of: timeline.date) { _ in
                    let time = timeline.date.timeIntervalSinceReferenceDate
                    breathingPhase = sin(time * 0.5) * 0.5 + 0.5
                    heartbeatPhase = abs(sin(time * 4))
                    
                    // Calculate harmony based on room comfort levels
                    harmonyLevel = rooms.map { $0.comfort }.reduce(0, +) / CGFloat(rooms.count)
                    
                    // Reveal hidden chamber when harmony is high
                    hiddenChamberRevealed = harmonyLevel > 0.6
                    
                    // Update organic opacity based on breathing
                    organicOpacity = 0.2 + breathingPhase * 0.3
                }
            }
        }
        .onAppear {
            _ = buildingMood
            _ = heartbeatPhase
            _ = activeSliderID
        }
    }
}