struct ContentView: View {
    @State private var timeThreads: [TimeThread] = [
        TimeThread(activity: .work, thickness: 3.0, color: Color(red: 0.2, green: 0.2, blue: 0.3)),
        TimeThread(activity: .rest, thickness: 2.0, color: Color(red: 0.7, green: 0.6, blue: 0.5)),
        TimeThread(activity: .creativity, thickness: 4.0, color: Color(red: 0.4, green: 0.3, blue: 0.6)),
        TimeThread(activity: .social, thickness: 2.5, color: Color(red: 0.6, green: 0.5, blue: 0.4))
    ]
    
    @State private var weavingPattern: [[ThreadSegment]] = Array(repeating: Array(repeating: ThreadSegment(), count: 24), count: 12)
    @State private var activeThread: TimeActivity?
    @State private var warpDistortion: CGFloat = 0
    @State private var temporalKnots: [TemporalKnot] = []
    @State private var hoveredPosition: CGPoint?
    @State private var draggedThread: DraggedThread?
    @State private var fabricRipple: CGFloat = 0
    @State private var selectedHour: Int?
    
    let loomWidth: CGFloat = 1200
    let loomHeight: CGFloat = 600
    
    var body: some View {
        ZStack {
            Color(red: 0.98, green: 0.97, blue: 0.96)
                .ignoresSafeArea()
            
            HStack(spacing: 0) {
                // Thread selection panel
                VStack(spacing: 0) {
                    Text("TEMPORAL THREADS")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.gray)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 20)
                        .padding(.top, 30)
                    
                    ScrollView {
                        VStack(spacing: 20) {
                            ForEach(timeThreads) { thread in
                                ThreadSpool(thread: thread, isActive: activeThread == thread.activity)
                                    .onTapGesture {
                                        withAnimation(.spring(response: 0.3)) {
                                            activeThread = thread.activity
                                        }
                                    }
                            }
                        }
                        .padding(20)
                    }
                    
                    Spacer()
                }
                .frame(width: 200)
                .background(Color(red: 0.96, green: 0.95, blue: 0.94))
                
                // Main loom interface
                ZStack {
                    // Warp threads (vertical)
                    ForEach(0..<24, id: \.self) { hour in
                        WarpThread(
                            hour: hour,
                            distortion: warpDistortion,
                            isSelected: selectedHour == hour
                        )
                        .position(
                            x: CGFloat(hour) * (loomWidth / 24) + 50,
                            y: loomHeight / 2
                        )
                    }
                    
                    // Woven pattern
                    ForEach(0..<12, id: \.self) { row in
                        ForEach(0..<24, id: \.self) { col in
                            if let segment = weavingPattern[safe: row]?[safe: col],
                               segment.thread != nil {
                                WovenSegment(
                                    segment: segment,
                                    position: CGPoint(
                                        x: CGFloat(col) * (loomWidth / 24) + 50,
                                        y: CGFloat(row) * 40 + 100
                                    ),
                                    ripple: fabricRipple
                                )
                            }
                        }
                    }
                    
                    // Temporal knots
                    ForEach(temporalKnots) { knot in
                        TemporalKnotView(knot: knot)
                            .position(knot.position)
                            .onTapGesture {
                                withAnimation(.spring()) {
                                    expandTemporalKnot(knot)
                                }
                            }
                    }
                    
                    // Active weaving indicator
                    if let draggedThread = draggedThread {
                        ActiveThreadIndicator(thread: draggedThread)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(
                    RadialGradient(
                        colors: [
                            Color(red: 0.99, green: 0.98, blue: 0.97),
                            Color(red: 0.96, green: 0.95, blue: 0.93)
                        ],
                        center: .center,
                        startRadius: 100,
                        endRadius: 600
                    )
                )
                .onContinuousHover { phase in
                    switch phase {
                    case .active(let location):
                        hoveredPosition = location
                        updateFabricRipple(at: location)
                    case .ended:
                        hoveredPosition = nil
                    }
                }
                .onDrop(of: [.text], delegate: WeavingDropDelegate(
                    weavingPattern: $weavingPattern,
                    temporalKnots: $temporalKnots
                ))
            }
            
            // Time perception overlay
            if selectedHour != nil {
                TimePerceptionOverlay(
                    hour: selectedHour!,
                    pattern: weavingPattern
                )
                .transition(.opacity.combined(with: .scale))
            }
        }
        .frame(width: 1440, height: 900)
    }
    
    func expandTemporalKnot(_ knot: TemporalKnot) {
        // Expand time pocket logic
    }
    
    func updateFabricRipple(at location: CGPoint) {
        withAnimation(.easeOut(duration: 0.3)) {
            fabricRipple = sin(location.x / 50) * cos(location.y / 50) * 10
        }
    }
}

struct TimeThread: Identifiable {
    let id = UUID()
    let activity: TimeActivity
    var thickness: CGFloat
    let color: Color
}

enum TimeActivity {
    case work, rest, creativity, social
    
    var icon: String {
        switch self {
        case .work: return "briefcase.fill"
        case .rest: return "moon.fill"
        case .creativity: return "paintbrush.fill"
        case .social: return "person.2.fill"
        }
    }
}

struct ThreadSegment {
    var thread: TimeThread?
    var density: CGFloat = 1.0
    var tension: CGFloat = 0
}

struct TemporalKnot: Identifiable {
    let id = UUID()
    let position: CGPoint
    var intensity: CGFloat
    var threads: [TimeThread]
}

struct DraggedThread {
    let thread: TimeThread
    let startPosition: CGPoint
    var currentPosition: CGPoint
}

struct ThreadSpool: View {
    let thread: TimeThread
    let isActive: Bool
    
    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(thread.color.opacity(0.2))
                    .frame(width: 80, height: 80)
                
                Circle()
                    .stroke(thread.color, lineWidth: thread.thickness * 2)
                    .frame(width: 60 + (isActive ? 10 : 0), height: 60 + (isActive ? 10 : 0))
                
                Image(systemName: thread.activity.icon)
                    .font(.system(size: 24))
                    .foregroundColor(thread.color)
            }
            
            Text(String(describing: thread.activity).uppercased())
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(thread.color)
        }
        .scaleEffect(isActive ? 1.1 : 1.0)
    }
}

struct WarpThread: View {
    let hour: Int
    let distortion: CGFloat
    let isSelected: Bool
    
    var body: some View {
        VStack(spacing: 4) {
            Text("\(hour)")
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .foregroundColor(.gray)
                .opacity(0.6)
            
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [
                            Color.gray.opacity(0.1),
                            Color.gray.opacity(0.3),
                            Color.gray.opacity(0.1)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(width: isSelected ? 3 : 1, height: 500)
                .scaleEffect(x: 1, y: 1 + sin(distortion + CGFloat(hour) * 0.2) * 0.1)
        }
    }
}

struct WovenSegment: View {
    let segment: ThreadSegment
    let position: CGPoint
    let ripple: CGFloat
    
    var body: some View {
        if let thread = segment.thread {
            RoundedRectangle(cornerRadius: 2)
                .fill(thread.color.opacity(segment.density))
                .frame(
                    width: (loomWidth / 24) * 0.8,
                    height: thread.thickness * 8
                )
                .rotationEffect(.degrees(segment.tension * 15))
                .offset(y: ripple * sin(position.x / 100))
        }
    }
    
    private let loomWidth: CGFloat = 1200
}

struct TemporalKnotView: View {
    let knot: TemporalKnot
    @State private var rotation: CGFloat = 0
    
    var body: some View {
        ZStack {
            ForEach(0..<knot.threads.count, id: \.self) { index in
                Circle()
                    .stroke(
                        knot.threads[index].color,
                        lineWidth: knot.threads[index].thickness
                    )
                    .frame(
                        width: 30 + CGFloat(index) * 10,
                        height: 30 + CGFloat(index) * 10
                    )
                    .rotationEffect(.degrees(rotation + Double(index) * 60))
            }
            
            Circle()
                .fill(Color.black.opacity(0.8))
                .frame(width: 8, height: 8)
        }
        .onAppear {
            withAnimation(.linear(duration: 20).repeatForever(autoreverses: false)) {
                rotation = 360
            }
        }
    }
}

struct ActiveThreadIndicator: View {
    let thread: DraggedThread
    
    var body: some View {
        Path { path in
            path.move(to: thread.startPosition)
            path.addCurve(
                to: thread.currentPosition,
                control1: CGPoint(
                    x: thread.startPosition.x,
                    y: thread.currentPosition.y
                ),
                control2: CGPoint(
                    x: thread.currentPosition.x,
                    y: thread.startPosition.y
                )
            )
        }
        .stroke(
            thread.thread.color,
            style: StrokeStyle(
                lineWidth: thread.thread.thickness,
                lineCap: .round,
                dash: [5, 3]
            )
        )
    }
}

struct TimePerceptionOverlay: View {
    let hour: Int
    let pattern: [[ThreadSegment]]
    
    var body: some View {
        VStack(spacing: 20) {
            Text("HOUR \(hour):00")
                .font(.system(size: 32, weight: .light, design: .serif))
            
            Text("This hour will feel...")
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(.gray)
            
            // Analysis of thread density
            HStack(spacing: 40) {
                ForEach(analyzeHour(), id: \.0) { activity, intensity in
                    VStack {
                        Circle()
                            .fill(threadColor(for: activity))
                            .frame(width: 60 * intensity, height: 60 * intensity)
                        
                        Text(String(describing: activity))
                            .font(.caption)
                    }
                }
            }
        }
        .padding(40)
        .background(Color.white.opacity(0.95))
        .cornerRadius(20)
        .shadow(radius: 20)
    }
    
    func analyzeHour() -> [(TimeActivity, CGFloat)] {
        // Analyze thread density for the hour
        return [
            (.work, 0.8),
            (.creativity, 0.6),
            (.rest, 0.3)
        ]
    }
    
    func threadColor(for activity: TimeActivity) -> Color {
        switch activity {
        case .work: return Color(red: 0.2, green: 0.2, blue: 0.3)
        case .rest: return Color(red: 0.7, green: 0.6, blue: 0.5)
        case .creativity: return Color(red: 0.4, green: 0.3, blue: 0.6)
        case .social: return Color(red: 0.6, green: 0.5, blue: 0.4)
        }
    }
}

struct WeavingDropDelegate: DropDelegate {
    @Binding var weavingPattern: [[ThreadSegment]]
    @Binding var temporalKnots: [TemporalKnot]
    
    func performDrop(info: DropInfo) -> Bool {
        // Handle thread dropping
        return true
    }
}

extension Array {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}