struct ContentView: View {
    @State private var touchPoint: CGPoint = .zero
    @State private var drawingPath = Path()
    @State private var luminosity: CGFloat = 0
    @State private var activeGesture: GestureType = .none
    @State private var floatingLights: [Light] = []
    @State private var dissolvedLights: [DissolvedLight] = []
    
    enum GestureType {
        case none, drawing, releasing
    }
    
    var body: some View {
        ZStack {
            // Deep night canvas
            Rectangle()
                .fill(Color(red: 0.05, green: 0.05, blue: 0.08))
                .ignoresSafeArea()
            
            // Dissolved light particles
            ForEach(dissolvedLights) { light in
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(red: 0.9, green: 0.7, blue: 0.4).opacity(light.opacity),
                                Color.clear
                            ],
                            center: .center,
                            startRadius: 0,
                            endRadius: light.radius
                        )
                    )
                    .frame(width: light.radius * 2, height: light.radius * 2)
                    .position(light.position)
            }
            
            // Floating lanterns
            ForEach(floatingLights) { light in
                LanternView(light: light)
                    .position(light.position)
                    .onTapGesture {
                        dissolveLantern(light)
                    }
            }
            
            // Active drawing glow
            if activeGesture == .drawing {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(red: 0.9, green: 0.7, blue: 0.4).opacity(luminosity * 0.6),
                                Color.clear
                            ],
                            center: .center,
                            startRadius: 0,
                            endRadius: 40 + (luminosity * 20)
                        )
                    )
                    .frame(width: 80 + (luminosity * 40), height: 80 + (luminosity * 40))
                    .position(touchPoint)
                    .allowsHitTesting(false)
            }
            
            // Drawing path
            drawingPath
                .stroke(
                    Color(red: 0.9, green: 0.7, blue: 0.4).opacity(luminosity * 0.8),
                    style: StrokeStyle(lineWidth: 2 + (luminosity * 2), lineCap: .round)
                )
                .blur(radius: 1)
                .allowsHitTesting(false)
            
            // Minimal UI hint
            if floatingLights.isEmpty && activeGesture == .none {
                Text("draw to release")
                    .font(.system(size: 14, weight: .light, design: .rounded))
                    .foregroundColor(Color.white.opacity(0.2))
                    .position(x: UIScreen.main.bounds.width / 2, y: UIScreen.main.bounds.height - 60)
            }
        }
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    if activeGesture == .none {
                        activeGesture = .drawing
                        drawingPath = Path()
                    }
                    
                    touchPoint = value.location
                    drawingPath.addLine(to: touchPoint)
                    
                    // Build luminosity based on gesture length
                    luminosity = min(1.0, luminosity + 0.005)
                }
                .onEnded { _ in
                    if luminosity > 0.3 {
                        releaseLantern()
                    }
                    activeGesture = .none
                    drawingPath = Path()
                    withAnimation(.easeOut(duration: 0.5)) {
                        luminosity = 0
                    }
                }
        )
        .onAppear {
            animateLights()
            cleanupParticles()
        }
    }
    
    func releaseLantern() {
        let newLight = Light(
            position: touchPoint,
            velocity: CGVector(dx: Double.random(in: -10...10), dy: -30 - (luminosity * 20)),
            intensity: luminosity
        )
        
        withAnimation(.easeOut(duration: 0.3)) {
            floatingLights.append(newLight)
        }
    }
    
    func dissolveLantern(_ light: Light) {
        withAnimation(.easeOut(duration: 0.2)) {
            floatingLights.removeAll { $0.id == light.id }
        }
        
        // Create particle dissolution
        for _ in 0..<Int(light.intensity * 20) {
            let particle = DissolvedLight(
                position: light.position,
                velocity: CGVector(
                    dx: Double.random(in: -50...50),
                    dy: Double.random(in: -50...50)
                ),
                opacity: light.intensity * 0.5,
                radius: CGFloat.random(in: 2...8)
            )
            dissolvedLights.append(particle)
        }
    }
    
    func animateLights() {
        Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { _ in
            withAnimation(.linear(duration: 0.016)) {
                // Update floating lights
                for index in floatingLights.indices {
                    floatingLights[index].position.x += floatingLights[index].velocity.dx * 0.016
                    floatingLights[index].position.y += floatingLights[index].velocity.dy * 0.016
                    
                    // Gentle drift
                    floatingLights[index].velocity.dx += Double.random(in: -0.5...0.5)
                    floatingLights[index].velocity.dx *= 0.98
                    
                    // Fade at screen edges
                    let fadeDistance: CGFloat = 100
                    if floatingLights[index].position.y < fadeDistance {
                        floatingLights[index].intensity *= 0.98
                    }
                }
                
                // Update dissolved particles
                for index in dissolvedLights.indices {
                    dissolvedLights[index].position.x += dissolvedLights[index].velocity.dx * 0.016
                    dissolvedLights[index].position.y += dissolvedLights[index].velocity.dy * 0.016
                    dissolvedLights[index].velocity.dy += 2 // gravity
                    dissolvedLights[index].opacity *= 0.96
                    dissolvedLights[index].radius *= 1.02
                }
            }
            
            // Remove faded elements
            floatingLights.removeAll { $0.intensity < 0.01 || $0.position.y < -50 }
            dissolvedLights.removeAll { $0.opacity < 0.01 }
        }
    }
    
    func cleanupParticles() {
        Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { _ in
            dissolvedLights.removeAll { $0.opacity < 0.1 }
        }
    }
}

struct Light: Identifiable {
    let id = UUID()
    var position: CGPoint
    var velocity: CGVector
    var intensity: CGFloat
}

struct DissolvedLight: Identifiable {
    let id = UUID()
    var position: CGPoint
    var velocity: CGVector
    var opacity: CGFloat
    var radius: CGFloat
}

struct LanternView: View {
    let light: Light
    
    var body: some View {
        ZStack {
            // Outer glow
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(red: 0.9, green: 0.7, blue: 0.4).opacity(light.intensity * 0.2),
                            Color.clear
                        ],
                        center: .center,
                        startRadius: 10,
                        endRadius: 40
                    )
                )
                .frame(width: 80, height: 80)
                .blur(radius: 3)
            
            // Inner light
            Circle()
                .fill(Color(red: 0.9, green: 0.7, blue: 0.4).opacity(light.intensity * 0.8))
                .frame(width: 20, height: 20)
                .blur(radius: 2)
        }
        .scaleEffect(0.8 + (light.intensity * 0.2))
    }
}