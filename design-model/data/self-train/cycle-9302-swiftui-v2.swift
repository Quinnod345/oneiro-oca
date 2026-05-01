struct ContentView: View {
    @State private var leftPaths: [DrawingPath] = []
    @State private var rightPaths: [DrawingPath] = []
    @State private var leftCurrentPath: DrawingPath?
    @State private var rightCurrentPath: DrawingPath?
    @State private var mergeProgress: CGFloat = 0
    @State private var autoMergeTimer: Timer?
    
    var divergenceScore: CGFloat {
        guard !leftPaths.isEmpty && !rightPaths.isEmpty else { return 0 }
        let leftDensity = calculatePathDensity(leftPaths)
        let rightDensity = calculatePathDensity(rightPaths)
        let overlap = calculateOverlap(leftPaths, rightPaths)
        return max(0, min(1, abs(leftDensity - rightDensity) - overlap))
    }
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(spacing: 12) {
                Text("THE ARGUMENT SETTLER")
                    .font(.system(size: 24, weight: .light))
                    .foregroundColor(.white)
                    .tracking(4)
                
                HStack(spacing: 40) {
                    Label("YOUR TRUTH", systemImage: "circle.fill")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(Color(red: 0.9, green: 0.3, blue: 0.3))
                    
                    Text("DIVERGENCE: \(Int(divergenceScore * 100))%")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.white.opacity(0.5))
                    
                    Label("THEIR TRUTH", systemImage: "circle.fill")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(Color(red: 0.3, green: 0.6, blue: 0.9))
                }
            }
            .padding(.vertical, 20)
            .frame(maxWidth: .infinity)
            .background(Color.black)
            
            // Main canvas
            GeometryReader { geo in
                ZStack {
                    Color(white: 0.05)
                    
                    HStack(spacing: 0) {
                        // Left canvas
                        DrawingCanvas(
                            paths: $leftPaths,
                            currentPath: $leftCurrentPath,
                            color: Color(red: 0.9, green: 0.3, blue: 0.3),
                            isEnabled: mergeProgress < 0.5
                        )
                        .opacity(1 - mergeProgress * 0.3)
                        
                        // Center divider
                        Rectangle()
                            .fill(Color.white.opacity(0.1 * (1 - mergeProgress)))
                            .frame(width: 1)
                        
                        // Right canvas
                        DrawingCanvas(
                            paths: $rightPaths,
                            currentPath: $rightCurrentPath,
                            color: Color(red: 0.3, green: 0.6, blue: 0.9),
                            isEnabled: mergeProgress < 0.5
                        )
                        .opacity(1 - mergeProgress * 0.3)
                    }
                    
                    // Merged view overlay
                    if mergeProgress > 0 {
                        MergedView(
                            leftPaths: leftPaths,
                            rightPaths: rightPaths,
                            progress: mergeProgress
                        )
                        .opacity(mergeProgress)
                    }
                    
                    // Instructions
                    if leftPaths.isEmpty && rightPaths.isEmpty {
                        VStack(spacing: 8) {
                            Text("Draw your memory of the event")
                                .font(.system(size: 16, weight: .light))
                            Text("Each person draws on their side")
                                .font(.system(size: 14, weight: .light))
                                .opacity(0.6)
                        }
                        .foregroundColor(.white.opacity(0.3))
                    }
                }
            }
            
            // Controls
            HStack(spacing: 20) {
                Button(action: { startMerge() }) {
                    Text("MERGE MEMORIES")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 20)
                                .fill(Color.white.opacity(0.15))
                        )
                }
                .disabled(leftPaths.isEmpty || rightPaths.isEmpty)
                .opacity((leftPaths.isEmpty || rightPaths.isEmpty) ? 0.3 : 1)
                
                Button(action: { reset() }) {
                    Text("RESET")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.white.opacity(0.6))
                }
            }
            .padding(.vertical, 20)
            .frame(maxWidth: .infinity)
            .background(Color.black)
        }
        .background(Color.black)
    }
    
    func startMerge() {
        withAnimation(.easeInOut(duration: 2)) {
            mergeProgress = 1
        }
    }
    
    func reset() {
        withAnimation(.easeOut(duration: 0.3)) {
            mergeProgress = 0
            leftPaths = []
            rightPaths = []
            leftCurrentPath = nil
            rightCurrentPath = nil
        }
    }
    
    func calculatePathDensity(_ paths: [DrawingPath]) -> CGFloat {
        let totalPoints = paths.reduce(0) { $0 + $1.points.count }
        return min(1, CGFloat(totalPoints) / 500)
    }
    
    func calculateOverlap(_ paths1: [DrawingPath], _ paths2: [DrawingPath]) -> CGFloat {
        // Simplified overlap calculation
        return 0.2
    }
}

struct DrawingCanvas: View {
    @Binding var paths: [DrawingPath]
    @Binding var currentPath: DrawingPath?
    let color: Color
    let isEnabled: Bool
    
    var body: some View {
        Canvas { context, size in
            // Draw completed paths
            for path in paths {
                context.stroke(
                    path.path,
                    with: .color(color),
                    lineWidth: 2
                )
            }
            
            // Draw current path
            if let current = currentPath {
                context.stroke(
                    current.path,
                    with: .color(color.opacity(0.6)),
                    lineWidth: 2
                )
            }
        }
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    guard isEnabled else { return }
                    if currentPath == nil {
                        currentPath = DrawingPath()
                    }
                    currentPath?.points.append(value.location)
                }
                .onEnded { _ in
                    guard isEnabled else { return }
                    if let path = currentPath {
                        paths.append(path)
                        currentPath = nil
                    }
                }
        )
    }
}

struct MergedView: View {
    let leftPaths: [DrawingPath]
    let rightPaths: [DrawingPath]
    let progress: CGFloat
    
    var body: some View {
        ZStack {
            // Background gradient showing merge
            LinearGradient(
                colors: [
                    Color(red: 0.9, green: 0.3, blue: 0.3).opacity(0.1),
                    Color(red: 0.3, green: 0.6, blue: 0.9).opacity(0.1)
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
            
            Canvas { context, size in
                // Draw left paths
                for path in leftPaths {
                    context.stroke(
                        path.path,
                        with: .color(Color(red: 0.9, green: 0.3, blue: 0.3).opacity(0.7)),
                        lineWidth: 2
                    )
                }
                
                // Draw right paths
                for path in rightPaths {
                    context.stroke(
                        path.path,
                        with: .color(Color(red: 0.3, green: 0.6, blue: 0.9).opacity(0.7)),
                        lineWidth: 2
                    )
                }
                
                // Draw overlap areas with highlight
                let overlapGradient = Gradient(colors: [
                    .white.opacity(0.3),
                    .white.opacity(0.1)
                ])
                
                for leftPath in leftPaths {
                    for rightPath in rightPaths {
                        if pathsOverlap(leftPath, rightPath) {
                            context.fill(
                                Circle().path(in: CGRect(x: size.width/2 - 50, y: size.height/2 - 50, width: 100, height: 100)),
                                with: .radialGradient(overlapGradient, center: .center, startRadius: 0, endRadius: 50)
                            )
                        }
                    }
                }
            }
        }
    }
    
    func pathsOverlap(_ path1: DrawingPath, _ path2: DrawingPath) -> Bool {
        // Simplified overlap detection
        guard !path1.points.isEmpty, !path2.points.isEmpty else { return false }
        return path1.points[0].distance(to: path2.points[0]) < 100
    }
}

struct DrawingPath {
    var points: [CGPoint] = []
    
    var path: Path {
        var path = Path()
        guard !points.isEmpty else { return path }
        
        path.move(to: points[0])
        for point in points.dropFirst() {
            path.addLine(to: point)
        }
        
        return path
    }
}

extension CGPoint {
    func distance(to point: CGPoint) -> CGFloat {
        sqrt(pow(x - point.x, 2) + pow(y - point.y, 2))
    }
}