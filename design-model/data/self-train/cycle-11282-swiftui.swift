struct ContentView: View {
    @State private var currentHumidity: Double = 0.5
    @State private var currentPressure: Double = 0.5
    @State private var currentTemperature: Double = 0.5
    @State private var weatherZones: [WeatherZone] = []
    @State private var historicalReadings: [EmotionalReading] = []
    @State private var topographicalData: [TopographicalPoint] = []
    @State private var forecastMessage: String = "Emotional climate stable"
    @State private var activeEmotionBlend: EmotionType = .calm
    @State private var particleTimer: Timer?
    @State private var cloudOffset: CGFloat = 0
    @State private var lightningPositions: [(start: CGPoint, end: CGPoint)] = []
    @State private var showLightning: Bool = false
    
    let atmosphericGradient = LinearGradient(
        stops: [
            .init(color: Color(red: 0.1, green: 0.1, blue: 0.2), location: 0.0),
            .init(color: Color(red: 0.2, green: 0.15, blue: 0.3), location: 0.3),
            .init(color: Color(red: 0.3, green: 0.2, blue: 0.4), location: 0.7),
            .init(color: Color(red: 0.15, green: 0.1, blue: 0.25), location: 1.0)
        ],
        startPoint: .top,
        endPoint: .bottom
    )
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Base atmospheric layer
                atmosphericGradient
                    .opacity(0.9 + currentPressure * 0.1)
                
                // Thermographic overlay
                Canvas { context, size in
                    for reading in historicalReadings.suffix(50) {
                        let x = (reading.timestamp.timeIntervalSinceNow + 3600) / 3600 * size.width * 0.8 + size.width * 0.1
                        let y = size.height * 0.7 - reading.intensity * 200
                        
                        let gradient = RadialGradient(
                            colors: [
                                reading.dominantEmotion.baseColor.opacity(0.6),
                                reading.dominantEmotion.baseColor.opacity(0.3),
                                reading.dominantEmotion.baseColor.opacity(0.1),
                                Color.clear
                            ],
                            center: .center,
                            startRadius: 5,
                            endRadius: 40 + reading.intensity * 30
                        )
                        
                        context.fill(
                            Circle().path(in: CGRect(x: x - 40, y: y - 40, width: 80, height: 80)),
                            with: .linearGradient(gradient, startPoint: CGPoint(x: x, y: y), endPoint: CGPoint(x: x + 40, y: y + 40))
                        )
                    }
                }
                .blur(radius: 2)
                
                // Weather zones with particles
                ForEach(weatherZones) { zone in
                    ZStack {
                        // Zone influence area
                        Circle()
                            .fill(zone.emotion.baseColor.opacity(0.1))
                            .frame(width: zone.radius * 2, height: zone.radius * 2)
                            .blur(radius: zone.radius * 0.1)
                            .position(zone.center)
                        
                        // Particles
                        ForEach(zone.particles) { particle in
                            Circle()
                                .fill(particle.color.opacity(particle.opacity))
                                .frame(width: 4 * particle.scale, height: 4 * particle.scale)
                                .rotationEffect(.degrees(particle.rotation))
                                .position(particle.position)
                        }
                    }
                }
                
                // Lightning for anger zones
                if showLightning {
                    ForEach(Array(lightningPositions.enumerated()), id: \.offset) { _, lightning in
                        Path { path in
                            path.move(to: lightning.start)
                            path.addLine(to: lightning.end)
                        }
                        .stroke(Color.white, lineWidth: 2)
                        .blur(radius: 1)
                        .opacity(0.8)
                    }
                }
                
                // Parallax cloud layers
                ForEach(0..<3) { layer in
                    CloudLayer(offset: cloudOffset * (1.0 + Double(layer) * 0.3), opacity: 0.3 - Double(layer) * 0.1)
                }
                
                // Control interface
                VStack {
                    HStack {
                        // Emotional forecast display
                        VStack(alignment: .leading, spacing: 12) {
                            Text("EMOTIONAL FORECAST")
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .foregroundColor(Color.white.opacity(0.6))
                            
                            Text(forecastMessage)
                                .font(.system(size: 18, weight: .light, design: .serif))
                                .foregroundColor(Color.white.opacity(0.9))
                            
                            HStack(spacing: 20) {
                                ForEach(Array(historicalReadings.suffix(5).enumerated()), id: \.offset) { _, reading in
                                    VStack(spacing: 4) {
                                        Circle()
                                            .fill(reading.dominantEmotion.baseColor)
                                            .frame(width: 8, height: 8)
                                        Text(timeString(from: reading.timestamp))
                                            .font(.system(size: 9, weight: .regular, design: .monospaced))
                                            .foregroundColor(Color.white.opacity(0.5))
                                    }
                                }
                            }
                        }
                        .padding()
                        .background(Color.black.opacity(0.4))
                        .cornerRadius(12)
                        
                        Spacer()
                    }
                    
                    Spacer()
                    
                    // Control panel
                    VStack(spacing: 16) {
                        HStack {
                            Text("EMOTIONAL CLIMATE CONTROLS")
                                .font(.system(size: 12, weight: .medium, design: .monospaced))
                                .foregroundColor(Color.white.opacity(0.7))
                            Spacer()
                        }
                        
                        VStack(spacing: 12) {
                            ControlSlider(label: "Humidity", value: $currentHumidity, color: Color.blue)
                            ControlSlider(label: "Pressure", value: $currentPressure, color: Color.orange)
                            ControlSlider(label: "Temperature", value: $currentTemperature, color: Color.red)
                        }
                        
                        HStack(spacing: 12) {
                            ForEach([EmotionType.calm, .joy, .anger, .sadness, .fear], id: \.self) { emotion in
                                Button(action: { triggerWeatherEvent(emotion: emotion, geometry: geometry) }) {
                                    VStack(spacing: 4) {
                                        Circle()
                                            .fill(emotion.baseColor)
                                            .frame(width: 40, height: 40)
                                        Text(emotionName(emotion))
                                            .font(.system(size: 10, weight: .medium))
                                            .foregroundColor(Color.white.opacity(0.8))
                                    }
                                }
                                .buttonStyle(PlainButtonStyle())
                            }
                        }
                    }
                    .padding()
                    .background(Color.black.opacity(0.5))
                    .cornerRadius(16)
                }
                .padding()
            }
        }
        .onAppear {
            startWeatherSimulation()
        }
    }
    
    func timeString(from date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
    
    func emotionName(_ emotion: EmotionType) -> String {
        switch emotion {
        case .calm: return "Calm"
        case .joy: return "Joy"
        case .anger: return "Anger"
        case .sadness: return "Sadness"
        case .fear: return "Fear"
        }
    }
    
    func triggerWeatherEvent(emotion: EmotionType, geometry: GeometryProxy) {
        let zone = WeatherZone(
            center: CGPoint(
                x: CGFloat.random(in: 100...geometry.size.width - 100),
                y: CGFloat.random(in: 100...geometry.size.height - 200)
            ),
            radius: CGFloat.random(in: 60...120),
            emotion: emotion,
            particles: generateParticles(for: emotion, center: CGPoint(x: 0, y: 0))
        )
        
        weatherZones.append(zone)
        
        let reading = EmotionalReading(
            timestamp: Date(),
            intensity: Double.random(in: 0.3...0.9),
            dominantEmotion: emotion
        )
        historicalReadings.append(reading)
        
        updateForecast()
        
        if emotion == .anger {
            generateLightning(in: geometry)
        }
    }
    
    func generateParticles(for emotion: EmotionType, center: CGPoint) -> [WeatherParticle] {
        (0..<20).map { _ in
            WeatherParticle(
                position: CGPoint(
                    x: center.x + CGFloat.random(in: -50...50),
                    y: center.y + CGFloat.random(in: -50...50)
                ),
                color: emotion.baseColor,
                opacity: Double.random(in: 0.3...0.8),
                scale: CGFloat.random(in: 0.5...1.5),
                rotation: Double.random(in: 0...360)
            )
        }
    }
    
    func generateLightning(in geometry: GeometryProxy) {
        showLightning = true
        lightningPositions = (0..<3).map { _ in
            let startX = CGFloat.random(in: 0...geometry.size.width)
            return (
                start: CGPoint(x: startX, y: 0),
                end: CGPoint(x: startX + CGFloat.random(in: -50...50), y: CGFloat.random(in: 200...400))
            )
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            showLightning = false
        }
    }
    
    func updateForecast() {
        let recentEmotions = historicalReadings.suffix(10)
        let emotionCounts = Dictionary(grouping: recentEmotions, by: { $0.dominantEmotion })
        
        if let dominantEmotion = emotionCounts.max(by: { $0.value.count < $1.value.count })?.key {
            switch dominantEmotion {
            case .calm:
                forecastMessage = "Clear skies ahead, emotional stability expected"
            case .joy:
                forecastMessage = "Bright conditions, happiness front moving in"
            case .anger:
                forecastMessage = "Storm warning: turbulent emotions approaching"
            case .sadness:
                forecastMessage = "Overcast conditions, melancholy showers likely"
            case .fear:
                forecastMessage = "Foggy outlook, uncertainty may persist"
            }
        }
    }
    
    func startWeatherSimulation() {
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            cloudOffset += 1
            
            for i in weatherZones.indices {
                for j in weatherZones[i].particles.indices {
                    weatherZones[i].particles[j].position.y -= CGFloat.random(in: 0.5...2)
                    weatherZones[i].particles[j].position.x += CGFloat.random(in: -0.5...0.5)
                    weatherZones[i].particles[j].opacity -= 0.01
                }
                weatherZones[i].particles.removeAll { $0.opacity <= 0 }
            }
            
            weatherZones.removeAll { $0.particles.isEmpty }
        }
    }
}

struct ControlSlider: View {
    let label: String
    @Binding var value: Double
    let color: Color
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(Color.white.opacity(0.7))
                Spacer()
                Text(String(format: "%.0f%%", value * 100))
                    .font(.system(size: 11, weight: .regular, design: .monospaced))
                    .foregroundColor(Color.white.opacity(0.5))
            }
            
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Rectangle()
                        .fill(Color.white.opacity(0.1))
                        .frame(height: 4)
                    
                    Rectangle()
                        .fill(color)
                        .frame(width: geometry.size.width * CGFloat(value), height: 4)
                }
                .gesture(
                    DragGesture()
                        .onChanged { drag in
                            let newValue = drag.location.x / geometry.size.width
                            value = max(0, min(1, Double(newValue)))
                        }
                )
            }
            .frame(height: 20)
        }
    }
}