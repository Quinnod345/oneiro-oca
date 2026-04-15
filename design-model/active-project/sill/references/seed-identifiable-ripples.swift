struct Fear: Identifiable {
    let id = UUID()
    var type: String
    var position: CGPoint
    var intensity: Double
    var color: Color
}

struct ContentView: View {
    @State private var availableFears: [Fear] = [
        Fear(type: "Isolation", position: CGPoint(x: 100, y: 200), intensity: 0.8, color: .blue),
        Fear(type: "Failure", position: CGPoint(x: 100, y: 400), intensity: 0.9, color: .red),
        Fear(type: "Loss", position: CGPoint(x: 100, y: 600), intensity: 0.7, color: .gray),
        Fear(type: "Abandonment", position: CGPoint(x: 1340, y: 200), intensity: 0.85, color: .purple),
        Fear(type: "Judgment", position: CGPoint(x: 1340, y: 400), intensity: 0.75, color: .orange),
        Fear(type: "Mortality", position: CGPoint(x: 1340, y: 600), intensity: 0.95, color: .black)
    ]
    
    @State private var vortexFears: [Fear] = []
    @State private var draggedFear: Fear?
    @State private var nightmareIntensity: Double = 0
    @State private var ripplePhase: Double = 0
    
    var body: some View {
        ZStack {
            // Dark pool background
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.05, green: 0.05, blue: 0.08),
                            Color(red: 0.02, green: 0.02, blue: 0.04)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .ignoresSafeArea()
            
            // Subtle ripples
            ForEach(0..<5) { index in
                Circle()
                    .stroke(
                        Color.white.opacity(0.05 - Double(index) * 0.01),
                        lineWidth: 1
                    )
                    .frame(width: 600 + Double(index) * 150 + ripplePhase * 20,
                           height: 600 + Double(index) * 150 + ripplePhase * 20)
                    .position(x: 720, y: 450)
            }
            
            // Central vortex
            VortexEffect(fears: vortexFears)
                .position(x: 720, y: 450)
            
            // Nightmare reflection
            if !vortexFears.isEmpty {
                let blend = NightmareBlend(fears: vortexFears, intensity: nightmareIntensity)
                
                VStack(spacing: 0) {
                    Text("NIGHTMARE SYNTHESIS")
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundColor(Color.white.opacity(0.3))
                        .tracking(3)
                    
                    Text(vortexFears.map { $0.type }.joined(separator: " + "))
                        .font(.system(size: 24, weight: .light, design: .serif))
                        .foregroundColor(blend.dominantColor.opacity(0.8))
                        .blur(radius: 0.5)
                        .scaleEffect(x: 1, y: -1)
                        .opacity(0.6)
                }
                .position(x: 720, y: 750)
            }
            
            // Fear entities
            ForEach(availableFears) { fear in
                FearEntity(fear: fear)
                    .position(fear.position)
                    .onDrag {
                        draggedFear = fear
                        return NSItemProvider(object: fear.id.uuidString as NSString)
                    }
            }
            
            // Drop zone indicator
            Circle()
                .stroke(Color.white.opacity(0.1), lineWidth: 2)
                .frame(width: 400, height: 400)
                .position(x: 720, y: 450)
                .onDrop(of: [.text], delegate: VortexDropDelegate(
                    vortexFears: $vortexFears,
                    availableFears: $availableFears,
                    draggedFear: $draggedFear,
                    nightmareIntensity: $nightmareIntensity
                ))
            
            // Intensity slider
            VStack {
                Text("EXPOSURE INTENSITY")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundColor(Color.white.opacity(0.5))
                    .tracking(2)
                
                Slider(value: $nightmareIntensity, in: 0...1)
                    .frame(width: 300)
                    .tint(Color.red.opacity(0.6))
            }
            .padding(30)
            .background(Color.black.opacity(0.3))
            .position(x: 720, y: 850)
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            withAnimation(.linear(duration: 8).repeatForever(autoreverses: true)) {
                ripplePhase = 1
            }
        }
    }
}

struct VortexDropDelegate: DropDelegate {
    @Binding var vortexFears: [Fear]
    @Binding var availableFears: [Fear]
    @Binding var draggedFear: Fear?
    @Binding var nightmareIntensity: Double
    
    func performDrop(info: DropInfo) -> Bool {
        guard let draggedFear = draggedFear else { return false }
        
        withAnimation(.easeInOut(duration: 0.5)) {
            var newFear = draggedFear
            newFear.position = CGPoint(x: 720, y: 450)
            vortexFears.append(newFear)
            availableFears.removeAll { $0.id == draggedFear.id }
            nightmareIntensity = min(1.0, nightmareIntensity + 0.2)
        }
        
        self.draggedFear = nil
        return true
    }
}

struct VortexEffect: View {
    let fears: [Fear]
    @State private var rotation: Double = 0
    
    var body: some View {
        ZStack {
            ForEach(fears.indices, id: \.self) { index in
                Circle()
                    .fill(fears[index].color.opacity(0.3))
                    .frame(width: 100, height: 100)
                    .scaleEffect(fears[index].intensity)
                    .offset(x: cos(rotation + Double(index) * .pi * 2 / Double(fears.count)) * 100,
                            y: sin(rotation + Double(index) * .pi * 2 / Double(fears.count)) * 100)
            }
        }
        .onAppear {
            withAnimation(.linear(duration: 10).repeatForever(autoreverses: false)) {
                rotation = .pi * 2
            }
        }
    }
}

struct FearEntity: View {
    let fear: Fear
    @State private var hover: Bool = false
    
    var body: some View {
        VStack(spacing: 8) {
            Circle()
                .fill(fear.color.opacity(0.7))
                .frame(width: 60, height: 60)
                .shadow(color: fear.color, radius: hover ? 20 : 10)
                .overlay(
                    Circle()
                        .stroke(Color.white.opacity(0.3), lineWidth: 2)
                )
            
            Text(fear.type)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundColor(Color.white.opacity(0.8))
        }
        .scaleEffect(hover ? 1.1 : 1.0)
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.2)) {
                hover = hovering
            }
        }
    }
}

struct NightmareBlend {
    let fears: [Fear]
    let intensity: Double
    
    var dominantColor: Color {
        if fears.isEmpty { return .black }
        return fears.max(by: { $0.intensity < $1.intensity })?.color ?? .black
    }
}