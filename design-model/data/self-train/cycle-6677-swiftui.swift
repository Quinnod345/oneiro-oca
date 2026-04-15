struct ContentView: View {
    @State private var memoryPlants: [MemoryPlant] = []
    @State private var soilLayers: [SoilLayer] = [
        SoilLayer(type: .sleep, depth: 0.2, quality: 0.7),
        SoilLayer(type: .stress, depth: 0.5, quality: 0.3),
        SoilLayer(type: .rehearsal, depth: 0.8, quality: 0.5)
    ]
    @State private var touchLocation: CGPoint = .zero
    @State private var isDragging = false
    @State private var selectedPlant: UUID?
    @State private var connectionPaths: [ConnectionPath] = []
    @State private var timeElapsed: Double = 0
    @State private var decayTimer: Timer?
    
    let timer = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            // Deep earth gradient
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.03, blue: 0.02),
                    Color(red: 0.08, green: 0.05, blue: 0.03),
                    Color(red: 0.12, green: 0.08, blue: 0.05)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            
            GeometryReader { geometry in
                // Soil cross-section
                ZStack {
                    ForEach(soilLayers) { layer in
                        SoilLayerView(
                            layer: layer,
                            geometry: geometry,
                            touchLocation: touchLocation,
                            isDragging: isDragging
                        )
                    }
                    
                    // Root connections
                    ForEach(connectionPaths) { path in
                        Path { p in
                            p.move(to: path.start)
                            p.addCurve(
                                to: path.end,
                                control1: CGPoint(x: path.start.x, y: path.start.y + 50),
                                control2: CGPoint(x: path.end.x, y: path.end.y + 50)
                            )
                        }
                        .stroke(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.7, green: 0.6, blue: 0.4).opacity(path.strength),
                                    Color(red: 0.5, green: 0.4, blue: 0.3).opacity(path.strength * 0.5)
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            ),
                            lineWidth: 2 * path.strength
                        )
                    }
                    
                    // Memory plants
                    ForEach(memoryPlants) { plant in
                        MemoryPlantView(
                            plant: plant,
                            isSelected: selectedPlant == plant.id,
                            soilQuality: calculateSoilQuality(at: plant.position.y)
                        )
                        .position(plant.position)
                        .onTapGesture {
                            withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) {
                                selectedPlant = selectedPlant == plant.id ? nil : plant.id
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
                .onContinuousHover { phase in
                    switch phase {
                    case .active(let location):
                        touchLocation = location
                    case .ended:
                        touchLocation = .zero
                    }
                }
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            isDragging = true
                            touchLocation = value.location
                            adjustSoilLayers(at: value.location, in: geometry)
                        }
                        .onEnded { _ in
                            isDragging = false
                        }
                )
            }
            
            // Interface overlay
            VStack {
                HStack {
                    // Memory input
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Plant New Memory")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(Color(red: 0.8, green: 0.7, blue: 0.6))
                        
                        Button(action: plantNewMemory) {
                            HStack(spacing: 6) {
                                Image(systemName: "leaf.fill")
                                    .font(.system(size: 14))
                                Text("Create Memory")
                                    .font(.system(size: 13))
                            }
                            .foregroundColor(Color(red: 0.9, green: 0.85, blue: 0.7))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(Color(red: 0.15, green: 0.1, blue: 0.05).opacity(0.8))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 6)
                                            .strokeBorder(Color(red: 0.4, green: 0.3, blue: 0.2).opacity(0.5), lineWidth: 1)
                                    )
                            )
                        }
                        .buttonStyle(PlainButtonStyle())
                    }
                    
                    Spacer()
                    
                    // Decay indicators
                    if let selected = memoryPlants.first(where: { $0.id == selectedPlant }) {
                        VStack(alignment: .trailing, spacing: 12) {
                            Text("Memory Strength: \(Int(selected.luminance * 100))%")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(Color(red: 0.8, green: 0.7, blue: 0.6))
                            
                            Text("Decay Rate: \(String(format: "%.1f", selected.decayRate * 60))% per hour")
                                .font(.system(size: 11))
                                .foregroundColor(Color(red: 0.6, green: 0.5, blue: 0.4))
                            
                            Text("Time to Critical: \(formatTime(selected.timeToCritical))")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(selected.timeToCritical < 3600 ? Color(red: 0.9, green: 0.4, blue: 0.3) : Color(red: 0.5, green: 0.7, blue: 0.4))
                        }
                        .padding(16)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(Color.black.opacity(0.3))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .strokeBorder(Color(red: 0.3, green: 0.25, blue: 0.2).opacity(0.5), lineWidth: 1)
                                )
                        )
                    }
                }
                .padding(24)
                
                Spacer()
                
                // Soil quality legend
                HStack(spacing: 32) {
                    ForEach(soilLayers) { layer in
                        HStack(spacing: 8) {
                            Circle()
                                .fill(layer.color)
                                .frame(width: 12, height: 12)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(layer.type.rawValue)
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundColor(Color(red: 0.7, green: 0.6, blue: 0.5))
                                Text("\(Int(layer.quality * 100))%")
                                    .font(.system(size: 10))
                                    .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
                            }
                        }
                    }
                }
                .padding(20)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.black.opacity(0.2))
                )
                .padding(24)
            }
        }
        .frame(width: 1440, height: 900)
        .onReceive(timer) { _ in
            updateMemoryDecay()
            updateConnections()
        }
        .onAppear {
            // Initialize with sample memories
            for _ in 0..<3 {
                plantNewMemory()
            }
        }
    }
    
    func plantNewMemory() {
        let newPlant = MemoryPlant(
            position: CGPoint(
                x: CGFloat.random(in: 200...1240),
                y: CGFloat.random(in: 300...600)
            ),
            content: "Memory \(memoryPlants.count + 1)",
            luminance: 1.0,
            decayRate: Double.random(in: 0.001...0.005),
            connections: []
        )
        
        withAnimation(.spring(response: 0.8, dampingFraction: 0.6)) {
            memoryPlants.append(newPlant)
        }
        
        // Create connections to nearby memories
        for existingPlant in memoryPlants where existingPlant.id != newPlant.id {
            let distance = hypot(
                newPlant.position.x - existingPlant.position.x,
                newPlant.position.y - existingPlant.position.y
            )
            
            if distance < 300 {
                let strength = 1.0 - (distance / 300)
                connectionPaths.append(
                    ConnectionPath(
                        start: newPlant.position,
                        end: existingPlant.position,
                        strength: strength
                    )
                )
            }
        }
    }
    
    func calculateSoilQuality(at depth: CGFloat) -> Double {
        let normalizedDepth = (depth - 300) / 300
        var totalQuality = 0.0
        var totalWeight = 0.0
        
        for layer in soilLayers {
            let distance = abs(layer.depth - normalizedDepth)
            let weight = max(0, 1 - distance * 2)
            totalQuality += layer.quality * weight
            totalWeight += weight
        }
        
        return totalWeight > 0 ? totalQuality / totalWeight : 0.5
    }
    
    func adjustSoilLayers(at location: CGPoint, in geometry: GeometryProxy) {
        let normalizedDepth = (location.y - 300) / 300
        
        for i in soilLayers.indices {
            let distance = abs(soilLayers[i].depth - normalizedDepth)
            if distance < 0.2 {
                let adjustment = (0.2 - distance) * 0.1
                withAnimation(.interactiveSpring(response: 0.3, dampingFraction: 0.7)) {
                    soilLayers[i].quality = min(1.0, max(0.0, soilLayers[i].quality + adjustment))
                }
            }
        }
    }
    
    func updateMemoryDecay() {
        timeElapsed += 0.1
        
        for i in memoryPlants.indices {
            let soilQuality = calculateSoilQuality(at: memoryPlants[i].position.y)
            let decayModifier = 1.0 - (soilQuality * 0.7)
            
            // Connection bonus
            let connectionBonus = connectionPaths
                .filter { $0.start == memoryPlants[i].position || $0.end == memoryPlants[i].position }
                .reduce(0.0) { $0 + $1.strength * 0.1 }
            
            let adjustedDecay = memoryPlants[i].decayRate * decayModifier * (1.0 - connectionBonus)
            
            withAnimation(.linear(duration: 0.1)) {
                memoryPlants[i].luminance = max(0.0, memoryPlants[i].luminance - adjustedDecay)
                memoryPlants[i].timeToCritical = memoryPlants[i].luminance > 0.2 
                    ? (memoryPlants[i].luminance - 0.2) / adjustedDecay 
                    : 0
            }
        }
        
        // Remove dead memories
        memoryPlants.removeAll { $0.luminance <= 0 }
        
        // Update connection strengths
        for i in connectionPaths.indices {
            if let plant1 = memoryPlants.first(where: { $0.position == connectionPaths[i].start }),
               let plant2 = memoryPlants.first(where: { $0.position == connectionPaths[i].end }) {
                connectionPaths[i].strength = min(plant1.luminance, plant2.luminance)
            }
        }
        
        // Remove dead connections
        connectionPaths.removeAll { $0.strength <= 0 }
    }
    
    func updateConnections() {
        // Pulse effect for active connections
        for i in connectionPaths.indices {
            let pulse = sin(timeElapsed * 2 + Double(i)) * 0.1 + 0.9
            connectionPaths[i].strength *= pulse
        }
    }
    
    func formatTime(_ seconds: Double) -> String {
        if seconds < 60 {
            return "\(Int(seconds))s"
        } else if seconds < 3600 {
            return "\(Int(seconds / 60))m"
        } else {
            return "\(Int(seconds / 3600))h"
        }
    }
}

struct MemoryPlant: Identifiable {
    let id = UUID()
    var position: CGPoint
    var content: String
    var luminance: Double
    var decayRate: Double
    var connections: [UUID]
    var timeToCritical: Double = 0
}

struct SoilLayer: Identifiable {
    let id = UUID()
    let type: LayerType
    let depth: Double
    var quality: Double
    
    enum LayerType: String {
        case sleep = "Sleep"
        case stress = "Stress"
        case rehearsal = "Rehearsal"
    }
    
    var color: Color {
        switch type {
        case .sleep:
            return Color(red: 0.2, green: 0.3, blue: 0.5)
        case .stress:
            return Color(red: 0.5, green: 0.2, blue: 0.2)
        case .rehearsal:
            return Color(red: 0.3, green: 0.5, blue: 0.3)
        }
    }
}

struct ConnectionPath: Identifiable {
    let id = UUID()
    let start: CGPoint
    let end: CGPoint
    var strength: Double
}

struct SoilLayerView: View {
    let layer: SoilLayer
    let geometry: GeometryProxy
    let touchLocation: CGPoint
    let isDragging: Bool
    
    var body: some View {
        let yPosition = 300 + (layer.depth * 300)
        let touchDistance = abs(touchLocation.y - yPosition)
        let touchEffect = isDragging && touchDistance < 100 ? (100 - touchDistance) / 100 : 0
        
        Rectangle()
            .fill(
                LinearGradient(
                    colors: [
                        layer.color.opacity(0.1 + layer.quality * 0.3 + touchEffect * 0.2),
                        layer.color.opacity(0.05 + layer.quality * 0.2)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .frame(height: 200)
            .scaleEffect(x: 1.0 + touchEffect * 0.02, y: 1.0, anchor: .center)
            .offset(y: yPosition - 100)
            .blur(radius: 20)
            .blendMode(.plusLighter)
    }
}

struct MemoryPlantView: View {
    let plant: MemoryPlant
    let isSelected: Bool
    let soilQuality: Double
    
    var body: some View {
        ZStack {
            // Glow effect
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(red: 0.8, green: 0.9, blue: 0.6).opacity(plant.luminance * 0.6),
                            Color.clear
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: 40 + plant.luminance * 20
                    )
                )
                .frame(width: 120, height: 120)
                .blur(radius: 10)
            
            // Plant stem
            Path { path in
                path.move(to: CGPoint(x: 0, y: 0))
                path.addCurve(
                    to: CGPoint(x: 0, y: 40),
                    control1: CGPoint(x: -10, y: 15),
                    control2: CGPoint(x: 10, y: 25)
                )
            }
            .stroke(
                LinearGradient(
                    colors: [
                        Color(red: 0.4, green: 0.6, blue: 0.3).opacity(plant.luminance),
                        Color(red: 0.3, green: 0.4, blue: 0.2).opacity(plant.luminance * 0.5)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                ),
                lineWidth: 3
            )
            
            // Bioluminescent bulb
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(red: 0.7 + plant.luminance * 0.3, green: 0.9, blue: 0.5 + plant.luminance * 0.5).opacity(plant.luminance),
                            Color(red: 0.5, green: 0.7, blue: 0.4).opacity(plant.luminance * 0.7),
                            Color(red: 0.3, green: 0.5, blue: 0.3).opacity(plant.luminance * 0.4)
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: 15
                    )
                )
                .frame(width: 30, height: 30)
                .overlay(
                    Circle()
                        .strokeBorder(
                            Color.white.opacity(plant.luminance * 0.3),
                            lineWidth: 1
                        )
                )
                .scaleEffect(0.8 + plant.luminance * 0.4)
                .shadow(color: Color(red: 0.7, green: 0.9, blue: 0.5).opacity(plant.luminance * 0.5), radius: 10)
            
            // Selection indicator
            if isSelected {
                Circle()
                    .strokeBorder(
                        Color(red: 0.9, green: 0.8, blue: 0.6).opacity(0.6),
                        lineWidth: 2
                    )
                    .frame(width: 50, height: 50)
                    .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: isSelected)
            }
            
            // Critical warning
            if plant.timeToCritical < 3600 && plant.luminance > 0.2 {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 14))
                    .foregroundColor(Color(red: 0.9, green: 0.4, blue: 0.3))
                    .offset(x: 20, y: -20)
                    .opacity(plant.timeToCritical < 1800 ? 1.0 : 0.6)
            }
        }
    }
}