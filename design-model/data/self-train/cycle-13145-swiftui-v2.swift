struct ContentView: View {
    @State private var currentEmotion: EmotionType = .calm
    @State private var weatherIntensity: CGFloat = 0.0
    @State private var touchLocation: CGPoint = .zero
    @State private var particles: [Particle] = []
    
    let timer = Timer.publish(every: 0.016, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            // Single background gradient
            LinearGradient(
                colors: backgroundColors,
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            
            // Primary weather effect
            Canvas { context, size in
                switch currentEmotion {
                case .calm:
                    drawCalmEffect(context: context, size: size)
                case .happy:
                    drawSunEffect(context: context, size: size)
                case .anxious:
                    drawStormEffect(context: context, size: size)
                case .sad:
                    drawRainEffect(context: context, size: size)
                }
                
                // Particles layer
                for particle in particles {
                    let opacity = 1.0 - (particle.age / particle.lifetime)
                    context.opacity = opacity * 0.6
                    
                    let rect = CGRect(
                        x: particle.position.x - particle.size/2,
                        y: particle.position.y - particle.size/2,
                        width: particle.size,
                        height: particle.size
                    )
                    
                    context.fill(
                        Circle().path(in: rect),
                        with: .color(particle.color)
                    )
                }
            }
            .allowsHitTesting(false)
            
            // Interaction layer
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { location in
                    touchLocation = location
                    animateWeatherChange()
                }
            
            // Simple emotion picker
            VStack {
                Spacer()
                
                HStack(spacing: 30) {
                    ForEach(EmotionType.allCases, id: \.self) { emotion in
                        Button(action: {
                            withAnimation(.easeInOut(duration: 0.8)) {
                                currentEmotion = emotion
                                weatherIntensity = 0
                            }
                        }) {
                            VStack(spacing: 8) {
                                Image(systemName: emotion.icon)
                                    .font(.system(size: 28))
                                Text(emotion.rawValue)
                                    .font(.caption)
                            }
                            .foregroundColor(currentEmotion == emotion ? .white : .white.opacity(0.6))
                            .scaleEffect(currentEmotion == emotion ? 1.1 : 1.0)
                        }
                    }
                }
                .padding(.horizontal, 40)
                .padding(.bottom, 50)
            }
        }
        .onReceive(timer) { _ in
            updateWeather()
            updateParticles()
        }
    }
    
    var backgroundColors: [Color] {
        switch currentEmotion {
        case .calm:
            return [Color(hex: "1a2f4a"), Color(hex: "2d4a6b")]
        case .happy:
            return [Color(hex: "87CEEB"), Color(hex: "FFE4B5")]
        case .anxious:
            return [Color(hex: "4a4a4a"), Color(hex: "2a2a2a")]
        case .sad:
            return [Color(hex: "5f6f7f"), Color(hex: "3a4a5a")]
        }
    }
    
    func drawCalmEffect(context: GraphicsContext, size: CGSize) {
        let waveHeight: CGFloat = 30 * weatherIntensity
        let waveCount = 3
        
        for i in 0..<waveCount {
            var path = Path()
            path.move(to: CGPoint(x: 0, y: size.height * 0.5))
            
            for x in stride(from: 0, to: size.width, by: 5) {
                let y = size.height * 0.5 + sin(x * 0.01 + weatherIntensity * 10 + Double(i)) * waveHeight
                path.addLine(to: CGPoint(x: x, y: y))
            }
            
            context.stroke(
                path,
                with: .color(.white.opacity(0.3 - Double(i) * 0.1)),
                lineWidth: 2
            )
        }
    }
    
    func drawSunEffect(context: GraphicsContext, size: CGSize) {
        let center = CGPoint(x: size.width * 0.5, y: size.height * 0.3)
        let radius = 80 * weatherIntensity
        
        // Sun glow
        for i in 1...3 {
            context.fill(
                Circle().path(in: CGRect(
                    x: center.x - radius * CGFloat(i),
                    y: center.y - radius * CGFloat(i),
                    width: radius * CGFloat(i) * 2,
                    height: radius * CGFloat(i) * 2
                )),
                with: .color(.yellow.opacity(0.3 / Double(i)))
            )
        }
        
        // Sun core
        context.fill(
            Circle().path(in: CGRect(
                x: center.x - radius/2,
                y: center.y - radius/2,
                width: radius,
                height: radius
            )),
            with: .color(.yellow)
        )
    }
    
    func drawStormEffect(context: GraphicsContext, size: CGSize) {
        let cloudY = size.height * 0.2
        let cloudWidth = size.width * 0.7
        let cloudHeight = 60.0
        
        // Storm cloud
        let cloudRect = CGRect(
            x: (size.width - cloudWidth) / 2,
            y: cloudY,
            width: cloudWidth,
            height: cloudHeight
        )
        
        context.fill(
            RoundedRectangle(cornerRadius: 30).path(in: cloudRect),
            with: .color(.gray.opacity(0.8 * Double(weatherIntensity)))
        )
        
        // Lightning flash
        if weatherIntensity > 0.7 && Int.random(in: 0...30) == 0 {
            context.fill(
                Rectangle().path(in: CGRect(x: 0, y: 0, width: size.width, height: size.height)),
                with: .color(.white.opacity(0.3))
            )
        }
    }
    
    func drawRainEffect(context: GraphicsContext, size: CGSize) {
        let dropCount = Int(weatherIntensity * 50)
        
        for _ in 0..<dropCount {
            let x = CGFloat.random(in: 0...size.width)
            let y = CGFloat.random(in: 0...size.height)
            let length = CGFloat.random(in: 10...20)
            
            var path = Path()
            path.move(to: CGPoint(x: x, y: y))
            path.addLine(to: CGPoint(x: x - 2, y: y + length))
            
            context.stroke(
                path,
                with: .color(.white.opacity(0.4)),
                lineWidth: 1
            )
        }
    }
    
    func animateWeatherChange() {
        withAnimation(.easeInOut(duration: 1.5)) {
            weatherIntensity = weatherIntensity > 0.8 ? 0 : 1.0
        }
        
        // Add particles at touch location
        for _ in 0..<10 {
            particles.append(Particle(
                position: touchLocation,
                velocity: CGPoint(
                    x: CGFloat.random(in: -50...50),
                    y: CGFloat.random(in: -50...50)
                ),
                size: CGFloat.random(in: 4...8),
                color: currentEmotion.particleColor,
                lifetime: Double.random(in: 1.0...2.0)
            ))
        }
    }
    
    func updateWeather() {
        // Smooth intensity changes
        if weatherIntensity < 1.0 && weatherIntensity > 0 {
            weatherIntensity = min(1.0, weatherIntensity + 0.01)
        }
    }
    
    func updateParticles() {
        particles = particles.compactMap { particle in
            var updated = particle
            updated.position.x += updated.velocity.x * 0.016
            updated.position.y += updated.velocity.y * 0.016
            updated.age += 0.016
            
            return updated.age < updated.lifetime ? updated : nil
        }
    }
}

enum EmotionType: String, CaseIterable {
    case calm = "Calm"
    case happy = "Happy"
    case anxious = "Anxious"
    case sad = "Sad"
    
    var icon: String {
        switch self {
        case .calm: return "moon"
        case .happy: return "sun.max"
        case .anxious: return "cloud.bolt"
        case .sad: return "cloud.rain"
        }
    }
    
    var particleColor: Color {
        switch self {
        case .calm: return .blue.opacity(0.6)
        case .happy: return .yellow.opacity(0.8)
        case .anxious: return .purple.opacity(0.5)
        case .sad: return .cyan.opacity(0.4)
        }
    }
}

struct Particle {
    var position: CGPoint
    var velocity: CGPoint
    var size: CGFloat
    var color: Color
    var lifetime: Double
    var age: Double = 0
}

extension Color {
    init(hex: String) {
        let scanner = Scanner(string: hex)
        scanner.currentIndex = hex.startIndex
        
        var rgb: UInt64 = 0
        scanner.scanHexInt64(&rgb)
        
        self.init(
            red: Double((rgb & 0xFF0000) >> 16) / 255.0,
            green: Double((rgb & 0x00FF00) >> 8) / 255.0,
            blue: Double(rgb & 0x0000FF) / 255.0
        )
    }
}