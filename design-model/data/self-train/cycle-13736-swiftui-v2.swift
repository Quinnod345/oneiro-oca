struct ContentView: View {
    @State private var timeNodes: [TimeNode] = []
    @State private var selectedHour: Int?
    @State private var hoveredHour: Int?
    @State private var animationPhase: Double = 0
    
    let center = CGPoint(x: 720, y: 450)
    let radius: Double = 280
    
    var body: some View {
        ZStack {
            Color(red: 0.05, green: 0.05, blue: 0.08)
                .ignoresSafeArea()
            
            // Main visualization
            Canvas { context, size in
                // Draw connection lines
                drawConnections(in: context)
                
                // Draw time ring
                drawTimeRing(in: context)
                
                // Draw hour markers
                drawHourMarkers(in: context)
            }
            .frame(width: 1440, height: 900)
            
            // Interactive nodes
            ForEach(timeNodes) { node in
                TimeNodeView(
                    node: node,
                    isSelected: selectedHour == Int(node.hour),
                    isHovered: hoveredHour == Int(node.hour)
                )
                .position(node.position)
                .onTapGesture {
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                        selectedHour = selectedHour == Int(node.hour) ? nil : Int(node.hour)
                    }
                }
                .onHover { isHovering in
                    hoveredHour = isHovering ? Int(node.hour) : nil
                }
            }
            
            // Info panel
            if let selected = selectedHour {
                VStack(alignment: .leading, spacing: 12) {
                    Text("\(selected):00")
                        .font(.system(size: 28, weight: .light, design: .rounded))
                        .foregroundColor(.white)
                    
                    if let node = timeNodes.first(where: { Int($0.hour) == selected }) {
                        Text("Energy Level")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.white.opacity(0.6))
                        
                        EnergyBar(value: node.energy)
                    }
                }
                .padding(24)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color.white.opacity(0.08))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16)
                                .stroke(Color.white.opacity(0.1), lineWidth: 1)
                        )
                )
                .position(x: 200, y: 450)
                .transition(.opacity.combined(with: .scale(scale: 0.9)))
            }
            
            // Header
            VStack {
                HStack {
                    Text("DAILY ENERGY PATTERN")
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundColor(.white.opacity(0.9))
                    
                    Spacer()
                    
                    Text(currentTimeString)
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundColor(.white.opacity(0.7))
                }
                .padding(.horizontal, 40)
                .padding(.top, 40)
                
                Spacer()
            }
        }
        .onAppear {
            initializeNodes()
            startAnimation()
        }
    }
    
    var currentTimeString: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: Date())
    }
    
    func initializeNodes() {
        for hour in 0..<24 {
            let angle = (Double(hour) / 24.0) * 2 * .pi - .pi / 2
            let x = center.x + cos(angle) * radius
            let y = center.y + sin(angle) * radius
            
            // Simulate energy patterns (higher in morning and afternoon)
            let energy = simulateEnergyPattern(hour: hour)
            
            timeNodes.append(TimeNode(
                hour: Double(hour),
                energy: energy,
                position: CGPoint(x: x, y: y)
            ))
        }
    }
    
    func simulateEnergyPattern(hour: Int) -> Double {
        // Morning peak around 10am, afternoon peak around 3pm
        let morningPeak = exp(-pow(Double(hour - 10), 2) / 18)
        let afternoonPeak = exp(-pow(Double(hour - 15), 2) / 25) * 0.8
        let nightDip = hour < 6 || hour > 22 ? 0.2 : 0.4
        
        return min(1.0, max(0.1, morningPeak + afternoonPeak + nightDip + Double.random(in: -0.1...0.1)))
    }
    
    func startAnimation() {
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            withAnimation(.linear(duration: 0.05)) {
                animationPhase += 0.02
            }
        }
    }
    
    func drawTimeRing(in context: GraphicsContext) {
        let ringPath = Path { path in
            path.addArc(center: center, radius: radius, startAngle: .zero, endAngle: .degrees(360), clockwise: false)
        }
        
        context.stroke(ringPath, with: .color(.white.opacity(0.1)), lineWidth: 1)
    }
    
    func drawHourMarkers(in context: GraphicsContext) {
        for hour in [0, 6, 12, 18] {
            let angle = (Double(hour) / 24.0) * 2 * .pi - .pi / 2
            let innerRadius = radius - 20
            let outerRadius = radius + 20
            
            let innerPoint = CGPoint(
                x: center.x + cos(angle) * innerRadius,
                y: center.y + sin(angle) * innerRadius
            )
            let outerPoint = CGPoint(
                x: center.x + cos(angle) * outerRadius,
                y: center.y + sin(angle) * outerRadius
            )
            
            context.stroke(
                Path { path in
                    path.move(to: innerPoint)
                    path.addLine(to: outerPoint)
                },
                with: .color(.white.opacity(0.3)),
                lineWidth: 2
            )
            
            let labelPoint = CGPoint(
                x: center.x + cos(angle) * (radius + 40),
                y: center.y + sin(angle) * (radius + 40)
            )
            
            context.draw(
                Text("\(hour):00")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundColor(.white.opacity(0.5)),
                at: labelPoint
            )
        }
    }
    
    func drawConnections(in context: GraphicsContext) {
        guard !timeNodes.isEmpty else { return }
        
        var path = Path()
        path.move(to: timeNodes[0].position)
        
        for i in 1..<timeNodes.count {
            let current = timeNodes[i].position
            let previous = timeNodes[i-1].position
            
            let control1 = CGPoint(
                x: previous.x + (current.x - previous.x) * 0.5,
                y: previous.y
            )
            let control2 = CGPoint(
                x: previous.x + (current.x - previous.x) * 0.5,
                y: current.y
            )
            
            path.addCurve(to: current, control1: control1, control2: control2)
        }
        
        // Close the path
        let first = timeNodes[0].position
        let last = timeNodes.last!.position
        let control1 = CGPoint(x: last.x, y: last.y + (first.y - last.y) * 0.5)
        let control2 = CGPoint(x: first.x, y: last.y + (first.y - last.y) * 0.5)
        path.addCurve(to: first, control1: control1, control2: control2)
        
        // Draw gradient fill
        let gradient = Gradient(colors: [
            Color(red: 0.2, green: 0.6, blue: 0.9).opacity(0.1),
            Color(red: 0.4, green: 0.7, blue: 1.0).opacity(0.05)
        ])
        
        context.fill(path, with: .linearGradient(
            gradient,
            startPoint: CGPoint(x: center.x, y: center.y - radius),
            endPoint: CGPoint(x: center.x, y: center.y + radius)
        ))
        
        context.stroke(path, with: .color(.white.opacity(0.2)), lineWidth: 1)
    }
}

struct TimeNode: Identifiable {
    let id = UUID()
    let hour: Double
    let energy: Double
    let position: CGPoint
}

struct TimeNodeView: View {
    let node: TimeNode
    let isSelected: Bool
    let isHovered: Bool
    
    var body: some View {
        ZStack {
            Circle()
                .fill(Color.white.opacity(0.05))
                .frame(width: 40, height: 40)
                .scaleEffect(isHovered ? 1.2 : 1.0)
            
            Circle()
                .fill(energyGradient)
                .frame(width: 20 * node.energy + 8, height: 20 * node.energy + 8)
            
            if isSelected {
                Circle()
                    .stroke(Color.white.opacity(0.8), lineWidth: 2)
                    .frame(width: 35, height: 35)
            }
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovered)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isSelected)
    }
    
    var energyGradient: LinearGradient {
        LinearGradient(
            colors: [
                Color(red: 0.3 + node.energy * 0.4, green: 0.6 + node.energy * 0.3, blue: 0.9),
                Color(red: 0.2 + node.energy * 0.3, green: 0.4 + node.energy * 0.4, blue: 0.8)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

struct EnergyBar: View {
    let value: Double
    
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.white.opacity(0.1))
                
                RoundedRectangle(cornerRadius: 4)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(red: 0.3, green: 0.6, blue: 0.9),
                                Color(red: 0.5, green: 0.8, blue: 1.0)
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: geometry.size.width * value)
            }
        }
        .frame(height: 8)
    }
}