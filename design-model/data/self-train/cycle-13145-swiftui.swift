struct ContentView: View {
    @State private var currentEmotion: EmotionType = .calm
    @State private var weatherEffects: [WeatherEffect] = []
    @State private var sunRayIntensity: Double = 0.0
    @State private var stormClouds: [CGPoint] = []
    @State private var raindrops: [CGPoint] = []
    @State private var puddleLevel: Double = 0.0
    @State private var auroraPhase: Double = 0.0
    @State private var breathingPhase: Double = 0.0
    @State private var memories: [Memory] = [
        Memory(text: "First day at the new job", warmth: 0.8),
        Memory(text: "Morning coffee with friends", warmth: 0.9),
        Memory(text: "Sunset walk by the lake", warmth: 0.7)
    ]
    @State private var hoveredElement: UUID?
    @State private var dragLocation: CGPoint = .zero
    @State private var cloudDrawingPath: [CGPoint] = []
    @State private var atmosphericPressure: Double = 0.5
    
    let timer = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()
    let breathingTimer = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Base atmospheric layer
                LinearGradient(
                    colors: atmosphereColors,
                    startPoint: .top,
                    endPoint: .bottom
                )
                .opacity(0.7)
                
                // Weather phenomena layers
                ForEach(weatherEffects) { effect in
                    switch effect.type {
                    case .happiness:
                        SunRayView(
                            center: effect.position,
                            intensity: effect.intensity * sunRayIntensity,
                            hoveredElement: hoveredElement
                        )
                    case .anxiety:
                        StormCloudView(
                            position: effect.position,
                            intensity: effect.intensity
                        )
                    case .sadness:
                        RainEffectView(
                            drops: raindrops,
                            intensity: effect.intensity
                        )
                    case .calm:
                        AuroraView(
                            phase: auroraPhase,
                            intensity: effect.intensity,
                            breathingPhase: breathingPhase
                        )
                    }
                }
                
                // Puddle reflection layer
                if puddleLevel > 0 {
                    VStack {
                        Spacer()
                        PuddleReflectionView(
                            level: puddleLevel,
                            memories: memories
                        )
                        .frame(height: min(200, puddleLevel * 300))
                    }
                }
                
                // Interactive controls
                VStack {
                    HStack {
                        EmotionSelector(
                            current: $currentEmotion,
                            onSelect: addWeatherEffect
                        )
                        
                        Spacer()
                        
                        AtmosphericPressureSlider(
                            pressure: $atmosphericPressure
                        )
                        .frame(width: 200)
                    }
                    .padding()
                    
                    Spacer()
                    
                    if currentEmotion == .calm {
                        BreathingGuide(phase: breathingPhase)
                            .padding(.bottom, 40)
                    }
                }
                
                // Cloud drawing overlay
                if currentEmotion == .anxiety && !cloudDrawingPath.isEmpty {
                    CloudDrawingView(path: cloudDrawingPath)
                }
            }
            .onAppear {
                addWeatherEffect(.calm)
            }
            .onReceive(timer) { _ in
                updateWeatherEffects()
            }
            .onReceive(breathingTimer) { _ in
                breathingPhase = (breathingPhase + 0.02).truncatingRemainder(dividingBy: 1.0)
            }
            .gesture(
                DragGesture()
                    .onChanged { value in
                        dragLocation = value.location
                        if currentEmotion == .anxiety {
                            cloudDrawingPath.append(value.location)
                        }
                    }
                    .onEnded { _ in
                        if currentEmotion == .anxiety && !cloudDrawingPath.isEmpty {
                            let center = cloudDrawingPath.reduce(CGPoint.zero) { acc, point in
                                CGPoint(x: acc.x + point.x / Double(cloudDrawingPath.count),
                                       y: acc.y + point.y / Double(cloudDrawingPath.count))
                            }
                            weatherEffects.append(WeatherEffect(
                                type: .anxiety,
                                position: center,
                                intensity: Double(cloudDrawingPath.count) / 100.0,
                                timestamp: Date()
                            ))
                            cloudDrawingPath = []
                        }
                    }
            )
        }
        .frame(width: 1440, height: 900)
    }
    
    var atmosphereColors: [Color] {
        switch currentEmotion {
        case .happiness:
            return [
                Color(red: 0.98, green: 0.92, blue: 0.84),
                Color(red: 1.0, green: 0.96, blue: 0.89),
                Color(red: 0.99, green: 0.94, blue: 0.87)
            ]
        case .anxiety:
            return [
                Color(red: 0.4, green: 0.4, blue: 0.5),
                Color(red: 0.3, green: 0.3, blue: 0.4),
                Color(red: 0.5, green: 0.5, blue: 0.6)
            ]
        case .sadness:
            return [
                Color(red: 0.6, green: 0.7, blue: 0.8),
                Color(red: 0.5, green: 0.6, blue: 0.7),
                Color(red: 0.4, green: 0.5, blue: 0.6)
            ]
        case .calm:
            return [
                Color(red: 0.9, green: 0.95, blue: 1.0),
                Color(red: 0.85, green: 0.9, blue: 0.95),
                Color(red: 0.95, green: 0.98, blue: 1.0)
            ]
        }
    }
    
    func addWeatherEffect(_ emotion: EmotionType) {
        let newEffect = WeatherEffect(
            type: emotion,
            position: CGPoint(x: 720, y: 450),
            intensity: 0.7,
            timestamp: Date()
        )
        weatherEffects.append(newEffect)
    }
    
    func updateWeatherEffects() {
        // Update sun ray intensity
        if currentEmotion == .happiness {
            sunRayIntensity = min(1.0, sunRayIntensity + 0.01)
        } else {
            sunRayIntensity = max(0.0, sunRayIntensity - 0.01)
        }
        
        // Update rain drops
        if currentEmotion == .sadness {
            if raindrops.count < 50 {
                raindrops.append(CGPoint(
                    x: Double.random(in: 0...1440),
                    y: -20
                ))
            }
            raindrops = raindrops.compactMap { drop in
                let newY = drop.y + 5
                return newY < 900 ? CGPoint(x: drop.x, y: newY) : nil
            }
            puddleLevel = min(1.0, puddleLevel + 0.001)
        } else {
            raindrops = []
            puddleLevel = max(0.0, puddleLevel - 0.002)
        }
        
        // Update aurora phase
        if currentEmotion == .calm {
            auroraPhase = (auroraPhase + 0.01).truncatingRemainder(dividingBy: 1.0)
        }
        
        // Clean up old weather effects
        let now = Date()
        weatherEffects = weatherEffects.filter { effect in
            now.timeIntervalSince(effect.timestamp) < 30
        }
    }
}

struct SunRayView: View {
    let center: CGPoint
    let intensity: Double
    let hoveredElement: UUID?
    
    var body: some View {
        Canvas { context, size in
            let rayCount = 12
            for i in 0..<rayCount {
                let angle = Double(i) * (2 * .pi / Double(rayCount))
                let length = 200 * intensity
                
                let path = Path { path in
                    path.move(to: center)
                    path.addLine(to: CGPoint(
                        x: center.x + cos(angle) * length,
                        y: center.y + sin(angle) * length
                    ))
                }
                
                context.stroke(path, with: .color(.yellow.opacity(0.6 * intensity)), lineWidth: 3)
            }
            
            context.fill(Circle().path(in: CGRect(
                x: center.x - 30,
                y: center.y - 30,
                width: 60,
                height: 60
            )), with: .color(.yellow.opacity(0.8 * intensity)))
        }
    }
}

struct StormCloudView: View {
    let position: CGPoint
    let intensity: Double
    
    var body: some View {
        Canvas { context, size in
            let cloudColor = Color(red: 0.3, green: 0.3, blue: 0.4)
            
            for i in 0..<5 {
                let offset = Double(i) * 20
                let circle = Circle().path(in: CGRect(
                    x: position.x - 40 + offset,
                    y: position.y - 20,
                    width: 60,
                    height: 60
                ))
                context.fill(circle, with: .color(cloudColor.opacity(0.7 * intensity)))
            }
        }
    }
}

struct RainEffectView: View {
    let drops: [CGPoint]
    let intensity: Double
    
    var body: some View {
        Canvas { context, size in
            for drop in drops {
                let path = Path { path in
                    path.move(to: drop)
                    path.addLine(to: CGPoint(x: drop.x, y: drop.y + 10))
                }
                context.stroke(path, with: .color(.blue.opacity(0.5 * intensity)), lineWidth: 1)
            }
        }
    }
}

struct AuroraView: View {
    let phase: Double
    let intensity: Double
    let breathingPhase: Double
    
    var body: some View {
        Canvas { context, size in
            let colors = [
                Color(red: 0.2, green: 0.8, blue: 0.6),
                Color(red: 0.3, green: 0.9, blue: 0.7),
                Color(red: 0.1, green: 0.7, blue: 0.9)
            ]
            
            for (index, color) in colors.enumerated() {
                let yOffset = sin(phase * 2 * .pi + Double(index)) * 50
                let path = Path { path in
                    path.move(to: CGPoint(x: 0, y: 200 + yOffset))
                    for x in stride(from: 0, to: size.width, by: 10) {
                        let y = 200 + yOffset + sin(x / 100 + phase * 10) * 30
                        path.addLine(to: CGPoint(x: x, y: y))
                    }
                    path.addLine(to: CGPoint(x: size.width, y: 0))
                    path.addLine(to: CGPoint(x: 0, y: 0))
                    path.closeSubpath()
                }
                
                let opacity = (0.3 + breathingPhase * 0.2) * intensity
                context.fill(path, with: .color(color.opacity(opacity)))
            }
        }
    }
}

struct PuddleReflectionView: View {
    let level: Double
    let memories: [Memory]
    
    var body: some View {
        VStack(spacing: 0) {
            ForEach(memories) { memory in
                Text(memory.text)
                    .foregroundColor(.white.opacity(0.7 * memory.warmth))
                    .scaleEffect(y: -1)
                    .opacity(level)
                    .padding(.vertical, 5)
            }
        }
        .background(
            LinearGradient(
                colors: [
                    Color.blue.opacity(0.3),
                    Color.blue.opacity(0.1)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }
}

struct EmotionSelector: View {
    @Binding var current: EmotionType
    let onSelect: (EmotionType) -> Void
    
    var body: some View {
        HStack(spacing: 20) {
            ForEach(EmotionType.allCases, id: \.self) { emotion in
                Button(action: {
                    current = emotion
                    onSelect(emotion)
                }) {
                    Text(emotionLabel(emotion))
                        .foregroundColor(current == emotion ? .white : .black)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 10)
                                .fill(current == emotion ? Color.blue : Color.gray.opacity(0.3))
                        )
                }
            }
        }
    }
    
    func emotionLabel(_ emotion: EmotionType) -> String {
        switch emotion {
        case .calm: return "Calm"
        case .happiness: return "Happy"
        case .anxiety: return "Anxious"
        case .sadness: return "Sad"
        }
    }
}

struct AtmosphericPressureSlider: View {
    @Binding var pressure: Double
    
    var body: some View {
        VStack {
            Text("Atmospheric Pressure")
                .font(.caption)
            Slider(value: $pressure, in: 0...1)
        }
    }
}

struct BreathingGuide: View {
    let phase: Double
    
    var body: some View {
        VStack {
            Circle()
                .fill(Color.blue.opacity(0.3))
                .frame(width: 100 + phase * 50, height: 100 + phase * 50)
                .overlay(
                    Text(breathingText)
                        .foregroundColor(.white)
                )
        }
    }
    
    var breathingText: String {
        if phase < 0.5 {
            return "Inhale"
        } else {
            return "Exhale"
        }
    }
}

struct CloudDrawingView: View {
    let path: [CGPoint]
    
    var body: some View {
        Canvas { context, size in
            if path.count > 1 {
                let drawPath = Path { p in
                    p.move(to: path[0])
                    for point in path.dropFirst() {
                        p.addLine(to: point)
                    }
                }
                context.stroke(drawPath, with: .color(.gray), style: StrokeStyle(lineWidth: 3, lineCap: .round))
            }
        }
    }
}