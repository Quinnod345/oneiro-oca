struct ContentView: View {
    @State private var excavationZones: [ExcavationZone] = []
    @State private var revealedFragments: [MessageFragment] = []
    @State private var activeZone: UUID?
    @State private var brushIntensity: CGFloat = 0
    @State private var currentGesture: DragGesture.Value?
    @State private var discoveryProgress: CGFloat = 0
    
    let buriedMessages = [
        "remember when we stayed up all night talking about the stars?",
        "i miss those sunday morning coffee runs",
        "you were right about everything",
        "why did we let it end like that?",
        "your laugh still echoes in empty rooms",
        "we were so young, so sure of forever"
    ]
    
    var body: some View {
        ZStack {
            // Subtle gradient background
            LinearGradient(
                colors: [
                    Color(red: 0.96, green: 0.95, blue: 0.94),
                    Color(red: 0.98, green: 0.97, blue: 0.96)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            
            VStack(spacing: 60) {
                // Discovered fragments display
                if !revealedFragments.isEmpty {
                    VStack(spacing: 24) {
                        ForEach(revealedFragments) { fragment in
                            Text(fragment.text)
                                .font(.custom("Baskerville", size: fragment.clarity * 24 + 16))
                                .foregroundColor(Color.black.opacity(fragment.clarity))
                                .blur(radius: (1 - fragment.clarity) * 3)
                                .scaleEffect(fragment.isRevealed ? 1 : 0.8)
                                .animation(.easeOut(duration: 1.2), value: fragment.isRevealed)
                        }
                    }
                    .padding(.horizontal, 80)
                    .frame(maxHeight: 200)
                }
                
                // Main excavation area
                ZStack {
                    ForEach(excavationZones) { zone in
                        ExcavationZoneView(
                            zone: zone,
                            isActive: activeZone == zone.id,
                            onExcavate: { intensity, location in
                                excavateZone(zone, intensity: intensity, at: location)
                            }
                        )
                    }
                }
                .frame(width: 800, height: 400)
                .background(
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color(red: 0.94, green: 0.93, blue: 0.92))
                        .shadow(color: Color.black.opacity(0.05), radius: 20, x: 0, y: 10)
                )
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            currentGesture = value
                            brushIntensity = min(1, value.velocity.magnitude / 1000)
                        }
                        .onEnded { _ in
                            currentGesture = nil
                            brushIntensity = 0
                        }
                )
                
                // Minimal progress indicator
                if discoveryProgress > 0 {
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            Rectangle()
                                .fill(Color.black.opacity(0.05))
                                .frame(height: 1)
                            
                            Rectangle()
                                .fill(Color.black.opacity(0.2))
                                .frame(width: geometry.size.width * discoveryProgress, height: 1)
                        }
                    }
                    .frame(height: 1)
                    .padding(.horizontal, 80)
                }
            }
            .padding(.vertical, 100)
            
            // Floating minimal controls
            VStack {
                Spacer()
                HStack {
                    Spacer()
                    if discoveryProgress > 0.2 {
                        Text("\(Int(discoveryProgress * 100))% uncovered")
                            .font(.custom("Baskerville", size: 14))
                            .foregroundColor(Color.black.opacity(0.4))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(Color.white.opacity(0.8))
                            .cornerRadius(20)
                            .transition(.opacity)
                    }
                }
                .padding(40)
            }
        }
        .frame(width: 1200, height: 800)
        .onAppear { initializeExcavation() }
    }
    
    func initializeExcavation() {
        // Create 3-5 elegant excavation zones
        excavationZones = (0..<4).map { index in
            ExcavationZone(
                id: UUID(),
                bounds: CGRect(
                    x: CGFloat(index % 2) * 400 + 50,
                    y: CGFloat(index / 2) * 200 + 50,
                    width: 350,
                    height: 150
                ),
                hiddenMessage: buriedMessages[index],
                excavationProgress: 0
            )
        }
    }
    
    func excavateZone(_ zone: ExcavationZone, intensity: CGFloat, at location: CGPoint) {
        guard let index = excavationZones.firstIndex(where: { $0.id == zone.id }) else { return }
        
        excavationZones[index].excavationProgress += intensity * 0.02
        
        if excavationZones[index].excavationProgress > 0.3 && !revealedFragments.contains(where: { $0.zoneId == zone.id }) {
            let fragment = MessageFragment(
                id: UUID(),
                zoneId: zone.id,
                text: zone.hiddenMessage,
                clarity: 0.3,
                isRevealed: false
            )
            revealedFragments.append(fragment)
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                if let fragIndex = revealedFragments.firstIndex(where: { $0.id == fragment.id }) {
                    revealedFragments[fragIndex].isRevealed = true
                }
            }
        }
        
        // Update fragment clarity
        if let fragIndex = revealedFragments.firstIndex(where: { $0.zoneId == zone.id }) {
            revealedFragments[fragIndex].clarity = min(1, excavationZones[index].excavationProgress)
        }
        
        // Update overall progress
        discoveryProgress = excavationZones.map { $0.excavationProgress }.reduce(0, +) / CGFloat(excavationZones.count)
    }
}

struct ExcavationZone: Identifiable {
    let id: UUID
    var bounds: CGRect
    var hiddenMessage: String
    var excavationProgress: CGFloat
}

struct ExcavationZoneView: View {
    let zone: ExcavationZone
    let isActive: Bool
    let onExcavate: (CGFloat, CGPoint) -> Void
    
    @State private var particlePositions: [CGPoint] = []
    
    var body: some View {
        ZStack {
            // Subtle sediment layer
            RoundedRectangle(cornerRadius: 2)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.92, green: 0.91, blue: 0.90).opacity(1 - zone.excavationProgress * 0.7),
                            Color(red: 0.88, green: 0.87, blue: 0.86).opacity(1 - zone.excavationProgress * 0.7)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: zone.bounds.width, height: zone.bounds.height)
                .overlay(
                    RoundedRectangle(cornerRadius: 2)
                        .stroke(Color.black.opacity(0.05), lineWidth: 1)
                )
            
            // Dust particles effect
            ForEach(particlePositions.indices, id: \.self) { index in
                Circle()
                    .fill(Color(red: 0.85, green: 0.84, blue: 0.83))
                    .frame(width: 2, height: 2)
                    .position(particlePositions[index])
                    .opacity(0.3)
                    .animation(.easeOut(duration: 2), value: particlePositions[index])
            }
        }
        .position(x: zone.bounds.midX, y: zone.bounds.midY)
        .onContinuousHover { phase in
            switch phase {
            case .active(let location):
                onExcavate(0.8, location)
                if particlePositions.count < 10 {
                    particlePositions.append(location)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        particlePositions.removeFirst()
                    }
                }
            case .ended:
                break
            }
        }
    }
}

struct MessageFragment: Identifiable {
    let id: UUID
    let zoneId: UUID
    let text: String
    var clarity: CGFloat
    var isRevealed: Bool
}

extension CGPoint {
    var velocity: CGVector {
        return CGVector(dx: x, dy: y)
    }
}

extension CGVector {
    var magnitude: CGFloat {
        return sqrt(dx * dx + dy * dy)
    }
}