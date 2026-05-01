struct ContentView: View {
    @State private var currentHumidity: Double = 0.5
    @State private var currentPressure: Double = 0.5
    @State private var currentTemperature: Double = 0.5
    @State private var forecastMessage: String = "Emotional climate stable"
    @State private var activeEmotionBlend: EmotionType = .calm
    @State private var historicalReadings: [EmotionalReading] = []
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(alignment: .leading, spacing: 4) {
                Text("Emotional Weather")
                    .font(.largeTitle)
                    .fontWeight(.semibold)
                
                Text(forecastMessage)
                    .font(.body)
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(Color(UIColor.systemBackground))
            
            // Main content
            ScrollView {
                VStack(spacing: 24) {
                    // Current conditions card
                    VStack(spacing: 16) {
                        HStack {
                            Image(systemName: activeEmotionBlend.weatherIcon)
                                .font(.system(size: 48))
                                .foregroundColor(activeEmotionBlend.baseColor)
                            
                            VStack(alignment: .leading, spacing: 4) {
                                Text(activeEmotionBlend.displayName)
                                    .font(.title2)
                                    .fontWeight(.medium)
                                
                                Text("Current emotional state")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            
                            Spacer()
                        }
                        
                        // Metrics
                        HStack(spacing: 20) {
                            MetricView(
                                label: "Intensity",
                                value: currentTemperature,
                                color: .orange
                            )
                            
                            MetricView(
                                label: "Stability",
                                value: currentPressure,
                                color: .blue
                            )
                            
                            MetricView(
                                label: "Volatility",
                                value: currentHumidity,
                                color: .purple
                            )
                        }
                    }
                    .padding()
                    .background(Color(UIColor.secondarySystemBackground))
                    .cornerRadius(12)
                    
                    // Historical chart
                    VStack(alignment: .leading, spacing: 12) {
                        Text("24 Hour History")
                            .font(.headline)
                        
                        ChartView(readings: historicalReadings)
                            .frame(height: 200)
                    }
                    .padding()
                    .background(Color(UIColor.secondarySystemBackground))
                    .cornerRadius(12)
                    
                    // Controls
                    VStack(spacing: 16) {
                        Text("Adjust Parameters")
                            .font(.headline)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        
                        SliderControl(
                            label: "Temperature",
                            value: $currentTemperature,
                            color: .orange
                        )
                        
                        SliderControl(
                            label: "Pressure",
                            value: $currentPressure,
                            color: .blue
                        )
                        
                        SliderControl(
                            label: "Humidity",
                            value: $currentHumidity,
                            color: .purple
                        )
                    }
                    .padding()
                    .background(Color(UIColor.secondarySystemBackground))
                    .cornerRadius(12)
                }
                .padding()
            }
        }
        .background(Color(UIColor.systemGroupedBackground))
        .onAppear {
            generateSampleData()
            updateForecast()
        }
        .onChange(of: currentTemperature) { _ in updateForecast() }
        .onChange(of: currentPressure) { _ in updateForecast() }
        .onChange(of: currentHumidity) { _ in updateForecast() }
    }
    
    func generateSampleData() {
        let emotions: [EmotionType] = [.calm, .joy, .melancholy, .anger, .anxiety]
        historicalReadings = (0..<24).map { hour in
            EmotionalReading(
                timestamp: Date().addingTimeInterval(Double(hour - 24) * 3600),
                intensity: Double.random(in: 0.3...0.8),
                dominantEmotion: emotions.randomElement() ?? .calm
            )
        }
    }
    
    func updateForecast() {
        let intensity = currentTemperature
        let stability = currentPressure
        let volatility = currentHumidity
        
        if intensity > 0.7 && volatility > 0.6 {
            activeEmotionBlend = .anger
            forecastMessage = "Emotional storms expected"
        } else if stability > 0.7 && intensity < 0.4 {
            activeEmotionBlend = .calm
            forecastMessage = "Clear and peaceful conditions"
        } else if intensity > 0.6 && stability > 0.5 {
            activeEmotionBlend = .joy
            forecastMessage = "Bright outlook ahead"
        } else if volatility > 0.7 {
            activeEmotionBlend = .anxiety
            forecastMessage = "Unsettled conditions"
        } else {
            activeEmotionBlend = .melancholy
            forecastMessage = "Overcast with occasional clarity"
        }
    }
}

struct MetricView: View {
    let label: String
    let value: Double
    let color: Color
    
    var body: some View {
        VStack(spacing: 8) {
            Text("\(Int(value * 100))%")
                .font(.title2)
                .fontWeight(.semibold)
                .foregroundColor(color)
            
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
            
            ProgressView(value: value)
                .tint(color)
        }
    }
}

struct SliderControl: View {
    let label: String
    @Binding var value: Double
    let color: Color
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(label)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                
                Spacer()
                
                Text("\(Int(value * 100))%")
                    .font(.subheadline)
                    .fontWeight(.medium)
            }
            
            Slider(value: $value, in: 0...1)
                .tint(color)
        }
    }
}

struct ChartView: View {
    let readings: [EmotionalReading]
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Grid lines
                Path { path in
                    for i in 0...4 {
                        let y = geometry.size.height * CGFloat(i) / 4
                        path.move(to: CGPoint(x: 0, y: y))
                        path.addLine(to: CGPoint(x: geometry.size.width, y: y))
                    }
                }
                .stroke(Color.secondary.opacity(0.2), lineWidth: 0.5)
                
                // Data line
                Path { path in
                    guard !readings.isEmpty else { return }
                    
                    let xStep = geometry.size.width / CGFloat(max(readings.count - 1, 1))
                    
                    for (index, reading) in readings.enumerated() {
                        let x = CGFloat(index) * xStep
                        let y = geometry.size.height * (1 - reading.intensity)
                        
                        if index == 0 {
                            path.move(to: CGPoint(x: x, y: y))
                        } else {
                            path.addLine(to: CGPoint(x: x, y: y))
                        }
                    }
                }
                .stroke(Color.accentColor, lineWidth: 2)
                
                // Data points
                ForEach(Array(readings.enumerated()), id: \.offset) { index, reading in
                    let xStep = geometry.size.width / CGFloat(max(readings.count - 1, 1))
                    let x = CGFloat(index) * xStep
                    let y = geometry.size.height * (1 - reading.intensity)
                    
                    Circle()
                        .fill(reading.dominantEmotion.baseColor)
                        .frame(width: 8, height: 8)
                        .position(x: x, y: y)
                }
            }
        }
    }
}

struct EmotionalReading: Identifiable {
    let id = UUID()
    let timestamp: Date
    let intensity: Double
    let dominantEmotion: EmotionType
}

enum EmotionType: CaseIterable {
    case calm, joy, melancholy, anger, anxiety
    
    var displayName: String {
        switch self {
        case .calm: return "Calm"
        case .joy: return "Joyful"
        case .melancholy: return "Melancholy"
        case .anger: return "Stormy"
        case .anxiety: return "Anxious"
        }
    }
    
    var baseColor: Color {
        switch self {
        case .calm: return .blue
        case .joy: return .yellow
        case .melancholy: return .indigo
        case .anger: return .red
        case .anxiety: return .purple
        }
    }
    
    var weatherIcon: String {
        switch self {
        case .calm: return "sun.max"
        case .joy: return "sun.max.fill"
        case .melancholy: return "cloud.rain"
        case .anger: return "cloud.bolt.rain.fill"
        case .anxiety: return "wind"
        }
    }
}