struct ContentView: View {
    @State private var availableFears: [Fear] = [
        Fear(type: "Isolation", angle: 0, intensity: 0.8, color: .blue),
        Fear(type: "Failure", angle: 60, intensity: 0.9, color: .red),
        Fear(type: "Loss", angle: 120, intensity: 0.7, color: .gray),
        Fear(type: "Abandonment", angle: 180, intensity: 0.85, color: .purple),
        Fear(type: "Judgment", angle: 240, intensity: 0.75, color: .orange),
        Fear(type: "Mortality", angle: 300, intensity: 0.95, color: .black)
    ]
    
    @State private var vortexFears: [Fear] = []
    @State private var draggedFear: Fear?
    @State private var nightmareIntensity: Double = 0
    @State private var ripplePhase: Double = 0
    
    var body: some View {
        GeometryReader { geometry in
            let center = CGPoint(x: geometry.size.width / 2, y: geometry.size.height / 2)
            let radius: CGFloat = min(geometry.size.width, geometry.size.height) * 0.35
            
            ZStack {
                // Dark pool background
                Rectangle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(red: 0.08, green: 0.08, blue: 0.12),
                                Color(red: 0.02, green: 0.02, blue: 0.04)
                            ],
                            center: .center,
                            startRadius: 0,
                            endRadius: geometry.size.width * 0.7
                        )
                    )
                    .ignoresSafeArea()
                
                // Subtle ripples
                ForEach(0..<3) { index in
                    Circle()
                        .stroke(
                            Color.white.opacity(0.03 - Double(index) * 0.01),
                            lineWidth: 0.5
                        )
                        .frame(
                            width: radius * 0.8 + CGFloat(index) * 60 + ripplePhase * 10,
                            height: radius * 0.8 + CGFloat(index) * 60 + ripplePhase * 10
                        )
                        .position(center)
                }
                
                // Central vortex area
                Circle()
                    .fill(Color.black.opacity(0.3))
                    .frame(width: radius * 0.8, height: radius * 0.8)
                    .position(center)
                    .overlay(
                        ForEach(vortexFears) { fear in
                            Text(fear.type)
                                .font(.system(size: 14, weight: .regular))
                                .foregroundColor(fear.color.opacity(0.6))
                                .position(
                                    x: center.x + CGFloat.random(in: -radius * 0.3...radius * 0.3),
                                    y: center.y + CGFloat.random(in: -radius * 0.3...radius * 0.3)
                                )
                                .animation(.easeInOut(duration: 2), value: vortexFears)
                        }
                    )
                
                // Fear entities in circular arrangement
                ForEach(availableFears) { fear in
                    let angle = Angle(degrees: fear.angle)
                    let x = center.x + cos(angle.radians) * radius
                    let y = center.y + sin(angle.radians) * radius
                    
                    FearEntity(fear: fear)
                        .position(x: x, y: y)
                        .onDrag {
                            draggedFear = fear
                            return NSItemProvider(object: fear.id.uuidString as NSString)
                        }
                }
                
                // Drop zone
                Circle()
                    .fill(Color.clear)
                    .frame(width: radius * 0.8, height: radius * 0.8)
                    .position(center)
                    .onDrop(of: [.text], delegate: VortexDropDelegate(
                        vortexFears: $vortexFears,
                        availableFears: $availableFears,
                        draggedFear: $draggedFear,
                        nightmareIntensity: $nightmareIntensity
                    ))
                
                // Nightmare synthesis
                if !vortexFears.isEmpty {
                    VStack(spacing: 8) {
                        Text("NIGHTMARE SYNTHESIS")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(Color.white.opacity(0.4))
                            .tracking(2)
                        
                        Text(vortexFears.map { $0.type }.joined(separator: " · "))
                            .font(.system(size: 16, weight: .regular))
                            .foregroundColor(Color.white.opacity(0.6))
                            .multilineTextAlignment(.center)
                    }
                    .position(x: center.x, y: center.y + radius * 1.2)
                }
                
                // Intensity control
                VStack(spacing: 8) {
                    Text("INTENSITY")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(Color.white.opacity(0.4))
                        .tracking(1.5)
                    
                    Slider(value: $nightmareIntensity, in: 0...1)
                        .frame(width: min(geometry.size.width * 0.3, 200))
                        .tint(Color.white.opacity(0.3))
                }
                .padding(16)
                .background(Color.black.opacity(0.2))
                .cornerRadius(8)
                .position(x: center.x, y: geometry.size.height - 60)
            }
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 6).repeatForever(autoreverses: true)) {
                ripplePhase = 1
            }
        }
    }
}

struct FearEntity: View {
    let fear: Fear
    
    var body: some View {
        VStack(spacing: 4) {
            Circle()
                .fill(fear.color.opacity(0.3))
                .frame(width: 44, height: 44)
                .overlay(
                    Circle()
                        .stroke(fear.color.opacity(0.5), lineWidth: 1)
                )
            
            Text(fear.type.uppercased())
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(Color.white.opacity(0.5))
                .tracking(0.5)
        }
    }
}

struct VortexDropDelegate: DropDelegate {
    @Binding var vortexFears: [Fear]
    @Binding var availableFears: [Fear]
    @Binding var draggedFear: Fear?
    @Binding var nightmareIntensity: Double
    
    func performDrop(info: DropInfo) -> Bool {
        guard let fear = draggedFear else { return false }
        
        withAnimation(.easeInOut) {
            if let index = availableFears.firstIndex(where: { $0.id == fear.id }) {
                availableFears.remove(at: index)
                vortexFears.append(fear)
                nightmareIntensity = min(1.0, nightmareIntensity + 0.2)
            }
        }
        
        return true
    }
}