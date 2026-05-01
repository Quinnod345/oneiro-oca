struct ContentView: View {
    @State private var events: [TimeEvent] = [
        TimeEvent(date: Date().addingTimeInterval(-86400 * 365 * 25), title: "Born into silence", significance: 0.9),
        TimeEvent(date: Date().addingTimeInterval(-86400 * 365 * 18), title: "First day of school", significance: 0.7),
        TimeEvent(date: Date().addingTimeInterval(-86400 * 365 * 16), title: "Learned to drive", significance: 0.4),
        TimeEvent(date: Date().addingTimeInterval(-86400 * 365 * 14), title: "First heartbreak", significance: 0.8),
        TimeEvent(date: Date().addingTimeInterval(-86400 * 365 * 10), title: "Graduated", significance: 0.6),
        TimeEvent(date: Date().addingTimeInterval(-86400 * 365 * 8), title: "Moved cities", significance: 0.9),
        TimeEvent(date: Date().addingTimeInterval(-86400 * 365 * 5), title: "Met them", significance: 1.0),
        TimeEvent(date: Date().addingTimeInterval(-86400 * 365 * 3), title: "Lost job", significance: 0.7),
        TimeEvent(date: Date().addingTimeInterval(-86400 * 365 * 2), title: "Found purpose", significance: 0.85),
        TimeEvent(date: Date().addingTimeInterval(-86400 * 200), title: "Small victory", significance: 0.3),
        TimeEvent(date: Date().addingTimeInterval(-86400 * 100), title: "Quiet morning", significance: 0.2),
        TimeEvent(date: Date(), title: "Today", significance: 0.5)
    ]
    
    @State private var foldPoints: [FoldPoint] = []
    @State private var draggedFold: UUID? = nil
    @State private var temporalZoom: Double = 1.0
    @State private var hoveredSegment: Int? = nil
    @State private var selectedEvent: UUID? = nil
    
    func findSegment(at x: CGFloat, width: CGFloat) -> Int {
        let normalizedX = x / width
        let sortedFolds = foldPoints.sorted { $0.position < $1.position }
        
        for (index, fold) in sortedFolds.enumerated() {
            if normalizedX < fold.position {
                return index
            }
        }
        
        return sortedFolds.count
    }
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Rectangle()
                    .fill(Color(red: 0.98, green: 0.96, blue: 0.92))
                    .overlay(
                        Rectangle()
                            .fill(
                                LinearGradient(
                                    colors: [
                                        Color(red: 0.95, green: 0.93, blue: 0.89).opacity(0.3),
                                        Color(red: 0.97, green: 0.95, blue: 0.91).opacity(0.1)
                                    ],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                    )
                
                VStack(spacing: 0) {
                    Text("Temporal Origami")
                        .font(.system(size: 14, weight: .light, design: .serif))
                        .foregroundColor(Color(red: 0.4, green: 0.35, blue: 0.3))
                        .padding(.top, 20)
                    
                    ZStack {
                        ForEach(0..<3) { layer in
                            TimelineFoldView(
                                events: events,
                                foldPoints: foldPoints,
                                width: geometry.size.width - 100,
                                height: geometry.size.height - 200,
                                layerOffset: CGFloat(layer) * 2,
                                opacity: 0.1 - Double(layer) * 0.03,
                                hoveredSegment: hoveredSegment,
                                selectedEvent: selectedEvent
                            )
                            .offset(y: CGFloat(layer) * 3)
                            .blur(radius: CGFloat(layer) * 0.5)
                        }
                        
                        TimelineFoldView(
                            events: events,
                            foldPoints: foldPoints,
                            width: geometry.size.width - 100,
                            height: geometry.size.height - 200,
                            layerOffset: 0,
                            opacity: 1.0,
                            hoveredSegment: hoveredSegment,
                            selectedEvent: selectedEvent
                        )
                        .onTapGesture { location in
                            let normalizedX = location.x / (geometry.size.width - 100)
                            let isCrease = Int.random(in: 0...1) == 0
                            
                            withAnimation(.interpolatingSpring(stiffness: 80, damping: 15)) {
                                foldPoints.append(
                                    FoldPoint(
                                        position: normalizedX,
                                        depth: Double.random(in: 0.3...0.8),
                                        isCrease: isCrease
                                    )
                                )
                            }
                        }
                        .gesture(
                            DragGesture()
                                .onChanged { value in
                                    hoveredSegment = findSegment(at: value.location.x, width: geometry.size.width - 100)
                                }
                                .onEnded { _ in
                                    hoveredSegment = nil
                                }
                        )
                    }
                    .frame(width: geometry.size.width - 100, height: geometry.size.height - 200)
                    .padding(.top, 40)
                    
                    if let selectedId = selectedEvent,
                       let event = events.first(where: { $0.id == selectedId }) {
                        VStack(spacing: 8) {
                            Text(event.title)
                                .font(.system(size: 16, weight: .medium, design: .serif))
                                .foregroundColor(Color(red: 0.3, green: 0.25, blue: 0.2))
                            
                            Text(event.date, style: .date)
                                .font(.system(size: 12, weight: .light, design: .serif))
                                .foregroundColor(Color(red: 0.5, green: 0.45, blue: 0.4))
                        }
                        .padding()
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(Color.white.opacity(0.7))
                                .shadow(radius: 2)
                        )
                        .transition(.opacity)
                    }
                    
                    Spacer()
                }
            }
        }
    }
}