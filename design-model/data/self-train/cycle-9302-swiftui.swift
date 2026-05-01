struct ContentView: View {
    @State private var leftPaths: [DrawingPath] = []
    @State private var rightPaths: [DrawingPath] = []
    @State private var leftCurrentPath: DrawingPath?
    @State private var rightCurrentPath: DrawingPath?
    @State private var mergeProgress: CGFloat = 0
    @State private var tiltAngle: Double = 0
    @State private var divergenceScore: CGFloat = 0
    @State private var autoMergeTimer: Timer?
    @State private var storyAlignment: CGFloat = 0
    
    var body: some View {
        ZStack {
            // Dynamic background gradient
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.05, blue: 0.08),
                    Color(red: 0.02, green: 0.02, blue: 0.04)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            
            VStack(spacing: 0) {
                // Title area with tilt indicator
                ZStack {
                    Text("THE ARGUMENT SETTLER")
                        .font(.system(size: 32, weight: .thin, design: .serif))
                        .foregroundColor(Color.white.opacity(0.9))
                        .tracking(8)
                    
                    HStack {
                        Text("YOUR TRUTH")
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundColor(Color.red.opacity(0.7))
                            .offset(x: -20)
                        
                        Spacer()
                        
                        Text("THEIR TRUTH")
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundColor(Color.blue.opacity(0.7))
                            .offset(x: 20)
                    }
                    .padding(.horizontal, 100)
                    .offset(y: 25)
                }
                .frame(height: 80)
                .rotation3DEffect(
                    .degrees(tiltAngle),
                    axis: (x: 0, y: 1, z: 0),
                    anchor: .center,
                    perspective: 0.5
                )
                
                // Main canvas area
                GeometryReader { geo in
                    ZStack {
                        // Dividing line that fades with merge
                        Rectangle()
                            .fill(Color.white.opacity(0.1 * (1 - mergeProgress)))
                            .frame(width: 1)
                            .position(x: geo.size.width / 2, y: geo.size.height / 2)
                        
                        HStack(spacing: 0) {
                            // Left canvas
                            MemoryCanvas(
                                participant: 1,
                                paths: $leftPaths,
                                currentPath: $leftCurrentPath,
                                mergeProgress: $mergeProgress,
                                otherPaths: rightPaths
                            )
                            .clipShape(Rectangle())
                            .offset(x: mergeProgress * geo.size.width * 0.25)
                            
                            // Right canvas
                            MemoryCanvas(
                                participant: 2,
                                paths: $rightPaths,
                                currentPath: $rightCurrentPath,
                                mergeProgress: $mergeProgress,
                                otherPaths: leftPaths
                            )
                            .clipShape(Rectangle())
                            .offset(x: -mergeProgress * geo.size.width * 0.25)
                        }
                        
                        // Heat map overlay
                        HeatMapOverlay(leftPaths: leftPaths, rightPaths: rightPaths)
                            .opacity(mergeProgress)
                        
                        // Memory fog for undrawn areas
                        ForEach(0..<15) { _ in
                            Circle()
                                .fill(
                                    RadialGradient(
                                        colors: [
                                            Color.gray.opacity(0.15),
                                            Color.clear
                                        ],
                                        center: .center,
                                        startRadius: 0,
                                        endRadius: 150
                                    )
                                )
                                .frame(width: 300, height: 300)
                                .position(
                                    x: CGFloat.random(in: 0...geo.size.width),
                                    y: CGFloat.random(in: 0...geo.size.height)
                                )
                                .blur(radius: 40)
                                .opacity(1.0 - mergeProgress * 0.3)
                        }
                    }
                    .background(Color.black.opacity(0.3))
                    .cornerRadius(8)
                    .rotation3DEffect(
                        .degrees(tiltAngle * 0.3),
                        axis: (x: 0, y: 1, z: 0),
                        anchor: .center,
                        perspective: 1
                    )
                }
                .padding(40)
                
                // Control area
                VStack(spacing: 20) {
                    // Divergence meter
                    VStack(spacing: 8) {
                        Text("STORY DIVERGENCE")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundColor(Color.white.opacity(0.6))
                        
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 4)
                                .fill(Color.white.opacity(0.1))
                                .frame(height: 8)
                            
                            RoundedRectangle(cornerRadius: 4)
                                .fill(
                                    LinearGradient(
                                        colors: [Color.green, Color.yellow, Color.red],
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    )
                                )
                                .frame(width: 200 * divergenceScore, height: 8)
                        }
                        .frame(width: 200)
                    }
                    
                    // Merge control
                    HStack(spacing: 30) {
                        Button(action: {
                            withAnimation(.easeInOut(duration: 2.0)) {
                                mergeProgress = mergeProgress > 0 ? 0 : 1
                                tiltAngle = mergeProgress > 0 ? 10 : 0
                            }
                        }) {
                            Text(mergeProgress > 0 ? "SEPARATE TRUTHS" : "MERGE MEMORIES")
                                .font(.system(size: 14, weight: .medium, design: .rounded))
                                .foregroundColor(.white)
                                .padding(.horizontal, 30)
                                .padding(.vertical, 12)
                                .background(
                                    Capsule()
                                        .fill(mergeProgress > 0 ? Color.purple : Color.blue)
                                        .opacity(0.6)
                                )
                        }
                        
                        Button(action: {
                            leftPaths.removeAll()
                            rightPaths.removeAll()
                            divergenceScore = 0
                            withAnimation {
                                mergeProgress = 0
                                tiltAngle = 0
                            }
                        }) {
                            Text("CLEAR ALL")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(.white.opacity(0.7))
                                .padding(.horizontal, 20)
                                .padding(.vertical, 10)
                                .background(
                                    Capsule()
                                        .stroke(Color.white.opacity(0.3), lineWidth: 1)
                                )
                        }
                    }
                    
                    // Status text
                    Text(mergeProgress > 0 ? "Memories converging..." : "Draw your version of events")
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundColor(Color.white.opacity(0.5))
                }
                .padding(.bottom, 40)
            }
        }
        .onAppear {
            calculateDivergence()
        }
        .onChange(of: leftPaths) { _ in calculateDivergence() }
        .onChange(of: rightPaths) { _ in calculateDivergence() }
    }
    
    func calculateDivergence() {
        let leftPoints = leftPaths.flatMap { $0.points }
        let rightPoints = rightPaths.flatMap { $0.points }
        
        guard !leftPoints.isEmpty && !rightPoints.isEmpty else {
            divergenceScore = 0
            return
        }
        
        var totalDiff: CGFloat = 0
        let sampleSize = min(leftPoints.count, rightPoints.count, 100)
        
        for i in 0..<sampleSize {
            let leftIndex = i * leftPoints.count / sampleSize
            let rightIndex = i * rightPoints.count / sampleSize
            
            if leftIndex < leftPoints.count && rightIndex < rightPoints.count {
                let dist = distance(leftPoints[leftIndex], rightPoints[rightIndex])
                totalDiff += min(dist / 500, 1.0)
            }
        }
        
        divergenceScore = min(totalDiff / CGFloat(sampleSize), 1.0)
    }
    
    func distance(_ p1: CGPoint, _ p2: CGPoint) -> CGFloat {
        sqrt(pow(p1.x - p2.x, 2) + pow(p1.y - p2.y, 2))
    }
}

struct MemoryCanvas: View {
    let participant: Int
    @Binding var paths: [DrawingPath]
    @Binding var currentPath: DrawingPath?
    @Binding var mergeProgress: CGFloat
    let otherPaths: [DrawingPath]
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Background
                Rectangle()
                    .fill(Color.black.opacity(0.05))
                
                // Other participant's paths (ghost view)
                ForEach(otherPaths) { path in
                    Path { p in
                        guard path.points.count > 1 else { return }
                        p.move(to: path.points[0])
                        for point in path.points.dropFirst() {
                            p.addLine(to: point)
                        }
                    }
                    .stroke(path.color.opacity(0.3 * mergeProgress), lineWidth: 2)
                }
                
                // Own paths
                ForEach(paths) { path in
                    Path { p in
                        guard path.points.count > 1 else { return }
                        p.move(to: path.points[0])
                        for point in path.points.dropFirst() {
                            p.addLine(to: point)
                        }
                    }
                    .stroke(path.color, lineWidth: 3)
                }
                
                // Current path being drawn
                if let current = currentPath {
                    Path { p in
                        guard current.points.count > 1 else { return }
                        p.move(to: current.points[0])
                        for point in current.points.dropFirst() {
                            p.addLine(to: point)
                        }
                    }
                    .stroke(current.color, lineWidth: 3)
                }
            }
            .contentShape(Rectangle())
            .onDragGesture(
                onDragStart: { value in
                    currentPath = DrawingPath(
                        points: [value.location],
                        color: participant == 1 ? Color.red : Color.blue
                    )
                },
                onDragChange: { value in
                    currentPath?.points.append(value.location)
                },
                onDragEnd: { _ in
                    if let path = currentPath {
                        paths.append(path)
                        currentPath = nil
                    }
                }
            )
        }
    }
}

struct HeatMapOverlay: View {
    let leftPaths: [DrawingPath]
    let rightPaths: [DrawingPath]
    
    var body: some View {
        GeometryReader { geometry in
            ForEach(0..<20) { i in
                ForEach(0..<20) { j in
                    let x = CGFloat(i) * geometry.size.width / 20
                    let y = CGFloat(j) * geometry.size.height / 20
                    let intensity = calculateIntensity(at: CGPoint(x: x, y: y))
                    
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    Color.purple.opacity(intensity),
                                    Color.clear
                                ],
                                center: .center,
                                startRadius: 0,
                                endRadius: 30
                            )
                        )
                        .frame(width: 60, height: 60)
                        .position(x: x, y: y)
                        .blendMode(.plusLighter)
                }
            }
        }
    }
    
    func calculateIntensity(at point: CGPoint) -> Double {
        let leftIntensity = calculatePathIntensity(paths: leftPaths, at: point)
        let rightIntensity = calculatePathIntensity(paths: rightPaths, at: point)
        return min(leftIntensity + rightIntensity, 1.0) * 0.5
    }
    
    func calculatePathIntensity(paths: [DrawingPath], at point: CGPoint) -> Double {
        var minDistance: CGFloat = .infinity
        
        for path in paths {
            for pathPoint in path.points {
                let dist = distance(point, pathPoint)
                minDistance = min(minDistance, dist)
            }
        }
        
        return max(0, 1 - (minDistance / 100))
    }
    
    func distance(_ p1: CGPoint, _ p2: CGPoint) -> CGFloat {
        sqrt(pow(p1.x - p2.x, 2) + pow(p1.y - p2.y, 2))
    }
}

extension View {
    func onDragGesture(
        onDragStart: @escaping (DragGesture.Value) -> Void,
        onDragChange: @escaping (DragGesture.Value) -> Void,
        onDragEnd: @escaping (DragGesture.Value) -> Void
    ) -> some View {
        self.gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    if value.translation.width == 0 && value.translation.height == 0 {
                        onDragStart(value)
                    }
                    onDragChange(value)
                }
                .onEnded(onDragEnd)
        )
    }
}