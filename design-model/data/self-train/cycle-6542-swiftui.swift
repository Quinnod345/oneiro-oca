struct ContentView: View {
    @State private var stars: [PhotoStar] = []
    @State private var constellations: [Constellation] = []
    @State private var selectedStar: PhotoStar?
    @State private var drawnConnections: [StarConnection] = []
    @State private var timeEpoch: TimeEpoch = .present
    @State private var isDrawingConnection = false
    @State private var connectionPath: [CGPoint] = []
    @State private var hoveredStar: PhotoStar?
    @State private var viewScale: CGFloat = 1.0
    @State private var viewOffset: CGSize = .zero
    @State private var memoryBrightness: CGFloat = 1.0
    
    let epochYears: [TimeEpoch] = [.distant, .years5, .years2, .recent, .present]
    
    var body: some View {
        ZStack {
            // Deep space background
            Rectangle()
                .fill(Color.black)
                .overlay(
                    Canvas { context, size in
                        // Cosmic dust and distant galaxies
                        for _ in 0..<200 {
                            let x = CGFloat.random(in: 0...size.width)
                            let y = CGFloat.random(in: 0...size.height)
                            let opacity = Double.random(in: 0.1...0.3)
                            
                            context.fill(
                                Path(ellipseIn: CGRect(x: x, y: y, width: 1, height: 1)),
                                with: .color(.white.opacity(opacity))
                            )
                        }
                    }
                )
            
            // Star field
            GeometryReader { geometry in
                ZStack {
                    // Constellation lines
                    ForEach(constellations) { constellation in
                        ConstellationView(
                            constellation: constellation,
                            stars: stars,
                            epoch: timeEpoch,
                            scale: viewScale
                        )
                    }
                    
                    // Drawn connections
                    ForEach(drawnConnections) { connection in
                        ConnectionView(
                            connection: connection,
                            stars: stars,
                            scale: viewScale
                        )
                    }
                    
                    // Active drawing path
                    if isDrawingConnection && connectionPath.count > 1 {
                        Path { path in
                            path.move(to: connectionPath[0])
                            for point in connectionPath.dropFirst() {
                                path.addLine(to: point)
                            }
                        }
                        .stroke(
                            LinearGradient(
                                colors: [Color.cyan, Color.blue.opacity(0.3)],
                                startPoint: .leading,
                                endPoint: .trailing
                            ),
                            lineWidth: 2
                        )
                        .blur(radius: 1)
                    }
                    
                    // Photo stars
                    ForEach(stars) { star in
                        PhotoStarView(
                            star: star,
                            isSelected: selectedStar?.id == star.id,
                            isHovered: hoveredStar?.id == star.id,
                            epoch: timeEpoch,
                            brightness: memoryBrightness,
                            scale: viewScale
                        )
                        .position(star.position)
                        .onTapGesture {
                            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                                if selectedStar?.id == star.id {
                                    selectedStar = nil
                                } else {
                                    selectedStar = star
                                    star.viewCount += 1
                                }
                            }
                        }
                        .onHover { isHovering in
                            hoveredStar = isHovering ? star : nil
                        }
                    }
                }
                .offset(viewOffset)
                .scaleEffect(viewScale)
                .onAppear {
                    generateStarField(in: geometry.size)
                }
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            if isDrawingConnection {
                                connectionPath.append(value.location)
                            } else {
                                viewOffset = CGSize(
                                    width: value.translation.width,
                                    height: value.translation.height
                                )
                            }
                        }
                        .onEnded { _ in
                            if isDrawingConnection {
                                processDrawnConnection()
                            }
                            isDrawingConnection = false
                            connectionPath = []
                        }
                )
            }
            
            // Time telescope controls
            VStack {
                Spacer()
                
                HStack(spacing: 40) {
                    // Time epoch selector
                    VStack(alignment: .leading, spacing: 12) {
                        Text("TIME TELESCOPE")
                            .font(.custom("Avenir Next", size: 11))
                            .fontWeight(.medium)
                            .foregroundColor(.white.opacity(0.5))
                            .tracking(2)
                        
                        HStack(spacing: 16) {
                            ForEach(epochYears, id: \.self) { epoch in
                                TimeEpochButton(
                                    epoch: epoch,
                                    isSelected: timeEpoch == epoch
                                ) {
                                    withAnimation(.easeInOut(duration: 0.8)) {
                                        timeEpoch = epoch
                                        redistributeStars()
                                    }
                                }
                            }
                        }
                    }
                    
                    Spacer()
                    
                    // Memory brightness control
                    VStack(alignment: .trailing, spacing: 12) {
                        Text("MEMORY LUMINANCE")
                            .font(.custom("Avenir Next", size: 11))
                            .fontWeight(.medium)
                            .foregroundColor(.white.opacity(0.5))
                            .tracking(2)
                        
                        HStack(spacing: 12) {
                            Image(systemName: "moon.fill")
                                .foregroundColor(.white.opacity(0.3))
                                .font(.system(size: 14))
                            
                            Slider(value: $memoryBrightness, in: 0.3...2.0)
                                .frame(width: 200)
                                .tint(.white.opacity(0.7))
                            
                            Image(systemName: "sun.max.fill")
                                .foregroundColor(.white.opacity(0.8))
                                .font(.system(size: 14))
                        }
                    }
                    
                    Spacer()
                    
                    // Connection mode toggle
                    Button(action: {
                        isDrawingConnection.toggle()
                        connectionPath = []
                    }) {
                        VStack(spacing: 8) {
                            Image(systemName: isDrawingConnection ? "pencil.circle.fill" : "pencil.circle")
                                .font(.system(size: 24))
                            Text("TRACE MEMORIES")
                                .font(.custom("Avenir Next", size: 10))
                                .tracking(1)
                        }
                        .foregroundColor(isDrawingConnection ? .cyan : .white.opacity(0.5))
                    }
                    .buttonStyle(PlainButtonStyle())
                }
                .padding(.horizontal, 60)
                .padding(.vertical, 30)
                .background(
                    Rectangle()
                        .fill(.black.opacity(0.8))
                        .overlay(
                            Rectangle()
                                .stroke(Color.white.opacity(0.1), lineWidth: 0.5)
                        )
                )
            }
            
            // Selected star detail
            if let selected = selectedStar {
                VStack {
                    HStack {
                        Spacer()
                        
                        StarDetailView(star: selected) {
                            withAnimation {
                                selectedStar = nil
                            }
                        }
                        .padding(40)
                    }
                    Spacer()
                }
            }
        }
        .frame(width: 1440, height: 900)
        .preferredColorScheme(.dark)
    }
    
    func generateStarField(in size: CGSize) {
        stars = (0..<150).map { _ in
            PhotoStar(
                position: CGPoint(
                    x: CGFloat.random(in: 100...size.width-100),
                    y: CGFloat.random(in: 100...size.height-100)
                ),
                originalPosition: CGPoint(
                    x: CGFloat.random(in: 100...size.width-100),
                    y: CGFloat.random(in: 100...size.height-100)
                ),
                photoDate: Date().addingTimeInterval(-Double.random(in: 0...315360000)),
                viewCount: Int.random(in: 0...50),
                faces: Int.random(in: 0...4),
                location: ["Paris", "Tokyo", "Home", "Beach", "Mountains", nil].randomElement() ?? nil
            )
        }
        
        // Generate some constellations
        generateConstellations()
    }
    
    func generateConstellations() {
        // Group stars by location
        let locationGroups = Dictionary(grouping: stars.filter { $0.location != nil }) { $0.location! }
        
        for (_, group) in locationGroups {
            if group.count >= 3 {
                let constellation = Constellation(
                    name: group[0].location ?? "Unknown",
                    starIds: Array(group.prefix(8).map { $0.id })
                )
                constellations.append(constellation)
            }
        }
    }
    
    func redistributeStars() {
        let center = CGPoint(x: 720, y: 450)
        let now = Date()
        
        for i in stars.indices {
            let timeDiff = now.timeIntervalSince(stars[i].photoDate)
            let epochMultiplier = timeEpoch.distanceMultiplier
            
            let angle = Double.random(in: 0...(2 * .pi))
            let baseDistance = CGFloat(100 + (timeDiff / 86400) * epochMultiplier)
            let randomOffset = CGFloat.random(in: 0.8...1.2)
            
            let newPosition = CGPoint(
                x: center.x + cos(angle) * baseDistance * randomOffset,
                y: center.y + sin(angle) * baseDistance * randomOffset
            )
            
            stars[i].position = newPosition
        }
    }
    
    func processDrawnConnection() {
        // Find stars near the path
        var connectedStars: [PhotoStar] = []
        
        for point in connectionPath {
            if let nearestStar = stars.first(where: { star in
                let distance = sqrt(pow(star.position.x - point.x, 2) + pow(star.position.y - point.y, 2))
                return distance < 50
            }) {
                if !connectedStars.contains(where: { $0.id == nearestStar.id }) {
                    connectedStars.append(nearestStar)
                }
            }
        }
        
        if connectedStars.count >= 2 {
            let connection = StarConnection(
                fromStarId: connectedStars[0].id,
                toStarId: connectedStars[1].id,
                strength: calculateConnectionStrength(connectedStars[0], connectedStars[1])
            )
            drawnConnections.append(connection)
        }
    }
    
    func calculateConnectionStrength(_ star1: PhotoStar, _ star2: PhotoStar) -> CGFloat {
        let timeDiff = abs(star1.photoDate.timeIntervalSince(star2.photoDate))
        let daysDiff = timeDiff / 86400
        
        if daysDiff < 1 { return 1.0 }
        if daysDiff < 7 { return 0.8 }
        if daysDiff < 30 { return 0.6 }
        if daysDiff < 365 { return 0.4 }
        return 0.2
    }
}

struct PhotoStar: Identifiable {
    let id = UUID()
    var position: CGPoint
    let originalPosition: CGPoint
    let photoDate: Date
    var viewCount: Int
    let faces: Int
    let location: String?
    
    var brightness: CGFloat {
        min(1.0, 0.2 + (CGFloat(viewCount) / 50.0) * 0.8)
    }
    
    var size: CGFloat {
        6 + CGFloat(faces) * 2 + brightness * 4
    }
}

struct Constellation: Identifiable {
    let id = UUID()
    let name: String
    let starIds: [UUID]
}

struct StarConnection: Identifiable {
    let id = UUID()
    let fromStarId: UUID
    let toStarId: UUID
    let strength: CGFloat
}

enum TimeEpoch {
    case distant  // 10+ years
    case years5   // 5-10 years
    case years2   // 2-5 years
    case recent   // 6 months - 2 years
    case present  // Last 6 months
    
    var label: String {
        switch self {
        case .distant: return "∞"
        case .years5: return "5Y"
        case .years2: return "2Y"
        case .recent: return "6M"
        case .present: return "NOW"
        }
    }
    
    var distanceMultiplier: Double {
        switch self {
        case .distant: return 0.2
        case .years5: return 0.4
        case .years2: return 0.6
        case .recent: return 0.8
        case .present: return 1.0
        }
    }
}

struct PhotoStarView: View {
    let star: PhotoStar
    let isSelected: Bool
    let isHovered: Bool
    let epoch: TimeEpoch
    let brightness: CGFloat
    let scale: CGFloat
    
    var adjustedBrightness: CGFloat {
        let timeDiff = Date().timeIntervalSince(star.photoDate)
        let epochFactor = 1.0 - (timeDiff / (10 * 365 * 86400)) * (1.0 - epoch.distanceMultiplier)
        return star.brightness * brightness * epochFactor
    }
    
    var body: some View {
        ZStack {
            // Outer glow
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color.white.opacity(adjustedBrightness * 0.3),
                            Color.cyan.opacity(adjustedBrightness * 0.1),
                            Color.clear
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: star.size * 3
                    )
                )
                .frame(width: star.size * 6, height: star.size * 6)
                .blur(radius: 2)
            
            // Core star
            Circle()
                .fill(Color.white.opacity(adjustedBrightness))
                .frame(width: star.size, height: star.size)
                .overlay(
                    Circle()
                        .stroke(Color.cyan.opacity(isHovered ? 0.8 : 0), lineWidth: 2)
                        .frame(width: star.size + 10, height: star.size + 10)
                )
            
            // Selection ring
            if isSelected {
                Circle()
                    .stroke(Color.cyan, lineWidth: 1)
                    .frame(width: star.size + 20, height: star.size + 20)
                    .rotationEffect(.degrees(isSelected ? 360 : 0))
                    .animation(.linear(duration: 20).repeatForever(autoreverses: false), value: isSelected)
            }
        }
        .scaleEffect(isHovered ? 1.2 : 1.0)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovered)
    }
}

struct ConstellationView: View {
    let constellation: Constellation
    let stars: [PhotoStar]
    let epoch: TimeEpoch
    let scale: CGFloat
    
    var body: some View {
        Canvas { context, size in
            let constellationStars = stars.filter { star in
                constellation.starIds.contains(star.id)
            }
            
            guard constellationStars.count >= 2 else { return }
            
            // Draw lines between stars
            for i in 0..<constellationStars.count - 1 {
                let star1 = constellationStars[i]
                let star2 = constellationStars[i + 1]
                
                var path = Path()
                path.move(to: star1.position)
                path.addLine(to: star2.position)
                
                context.stroke(
                    path,
                    with: .linearGradient(
                        Gradient(colors: [
                            Color.blue.opacity(0.3),
                            Color.purple.opacity(0.2)
                        ]),
                        startPoint: star1.position,
                        endPoint: star2.position
                    ),
                    lineWidth: 1
                )
            }
        }
    }
}

struct ConnectionView: View {
    let connection: StarConnection
    let stars: [PhotoStar]
    let scale: CGFloat
    
    var body: some View {
        Canvas { context, size in
            guard let fromStar = stars.first(where: { $0.id == connection.fromStarId }),
                  let toStar = stars.first(where: { $0.id == connection.toStarId }) else { return }
            
            var path = Path()
            path.move(to: fromStar.position)
            path.addLine(to: toStar.position)
            
            context.stroke(
                path,
                with: .color(.cyan.opacity(connection.strength * 0.5)),
                style: StrokeStyle(lineWidth: 2, dash: [5, 5])
            )
        }
    }
}

struct TimeEpochButton: View {
    let epoch: TimeEpoch
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            Text(epoch.label)
                .font(.custom("Avenir Next", size: 14))
                .fontWeight(isSelected ? .semibold : .regular)
                .foregroundColor(isSelected ? .cyan : .white.opacity(0.5))
                .frame(width: 50, height: 30)
                .background(
                    RoundedRectangle(cornerRadius: 4)
                        .fill(isSelected ? Color.cyan.opacity(0.1) : Color.clear)
                        .overlay(
                            RoundedRectangle(cornerRadius: 4)
                                .stroke(isSelected ? Color.cyan.opacity(0.3) : Color.white.opacity(0.1), lineWidth: 0.5)
                        )
                )
        }
        .buttonStyle(PlainButtonStyle())
    }
}

struct StarDetailView: View {
    let star: PhotoStar
    let onClose: () -> Void
    
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text("MEMORY DETAILS")
                    .font(.custom("Avenir Next", size: 12))
                    .fontWeight(.medium)
                    .tracking(2)
                    .foregroundColor(.white.opacity(0.5))
                
                Spacer()
                
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .foregroundColor(.white.opacity(0.5))
                        .font(.system(size: 12))
                }
                .buttonStyle(PlainButtonStyle())
            }
            
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Image(systemName: "calendar")
                        .foregroundColor(.cyan.opacity(0.7))
                        .font(.system(size: 14))
                    Text(star.photoDate.formatted(date: .abbreviated, time: .omitted))
                        .font(.custom("Avenir Next", size: 14))
                        .foregroundColor(.white.opacity(0.8))
                }
                
                if let location = star.location {
                    HStack {
                        Image(systemName: "location")
                            .foregroundColor(.cyan.opacity(0.7))
                            .font(.system(size: 14))
                        Text(location)
                            .font(.custom("Avenir Next", size: 14))
                            .foregroundColor(.white.opacity(0.8))
                    }
                }
                
                HStack {
                    Image(systemName: "eye")
                        .foregroundColor(.cyan.opacity(0.7))
                        .font(.system(size: 14))
                    Text("Viewed \(star.viewCount) times")
                        .font(.custom("Avenir Next", size: 14))
                        .foregroundColor(.white.opacity(0.8))
                }
                
                if star.faces > 0 {
                    HStack {
                        Image(systemName: "person.2")
                            .foregroundColor(.cyan.opacity(0.7))
                            .font(.system(size: 14))
                        Text("\(star.faces) people")
                            .font(.custom("Avenir Next", size: 14))
                            .foregroundColor(.white.opacity(0.8))
                    }
                }
            }
        }
        .padding(24)
        .frame(width: 280)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(.black.opacity(0.9))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.cyan.opacity(0.2), lineWidth: 0.5)
                )
        )
    }
}