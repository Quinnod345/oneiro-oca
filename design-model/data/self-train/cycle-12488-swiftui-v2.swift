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
    @State private var hoveredSegment: Int? = nil
    @State private var selectedEvent: TimeEvent? = nil
    @State private var draggedFold: FoldPoint? = nil
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.white
                    .ignoresSafeArea()
                
                VStack(spacing: 32) {
                    Text("Temporal Origami")
                        .font(.custom("Georgia", size: 24))
                        .fontWeight(.light)
                        .foregroundColor(.black)
                        .padding(.top, 48)
                    
                    ZStack {
                        ForEach(0..<3) { layer in
                            TimelineFoldView(
                                events: events,
                                foldPoints: foldPoints,
                                width: geometry.size.width - 80,
                                height: geometry.size.height - 240,
                                selectedEvent: selectedEvent
                            )
                            .offset(y: CGFloat(layer) * 2)
                            .opacity(0.08 - Double(layer) * 0.03)
                            .blur(radius: CGFloat(layer) * 1.5)
                        }
                        
                        TimelineFoldView(
                            events: events,
                            foldPoints: foldPoints,
                            width: geometry.size.width - 80,
                            height: geometry.size.height - 240,
                            selectedEvent: selectedEvent
                        )
                        .onTapGesture { location in
                            let normalizedX = location.x / (geometry.size.width - 80)
                            withAnimation(.easeInOut(duration: 0.6)) {
                                foldPoints.append(
                                    FoldPoint(
                                        position: normalizedX,
                                        depth: Double.random(in: 0.3...0.7),
                                        isCrease: Bool.random()
                                    )
                                )
                            }
                        }
                    }
                    .padding(.horizontal, 40)
                    
                    HStack(spacing: 24) {
                        Button(action: {
                            withAnimation(.easeInOut(duration: 0.5)) {
                                foldPoints.removeAll()
                            }
                        }) {
                            Text("Unfold")
                                .font(.system(size: 14, design: .default))
                                .foregroundColor(.black.opacity(0.7))
                                .padding(.horizontal, 20)
                                .padding(.vertical, 10)
                                .background(
                                    RoundedRectangle(cornerRadius: 6)
                                        .stroke(Color.black.opacity(0.2), lineWidth: 1)
                                )
                        }
                        
                        Text("\(foldPoints.count) folds")
                            .font(.system(size: 12))
                            .foregroundColor(.black.opacity(0.5))
                    }
                    .padding(.bottom, 48)
                }
            }
        }
    }
}

struct TimelineFoldView: View {
    let events: [TimeEvent]
    let foldPoints: [FoldPoint]
    let width: CGFloat
    let height: CGFloat
    let selectedEvent: TimeEvent?
    
    var body: some View {
        Canvas { context, size in
            let sortedEvents = events.sorted { $0.date < $1.date }
            guard let firstDate = sortedEvents.first?.date,
                  let lastDate = sortedEvents.last?.date else { return }
            
            let timespan = lastDate.timeIntervalSince(firstDate)
            let sortedFolds = foldPoints.sorted { $0.position < $1.position }
            
            var segments: [(start: Double, end: Double, transform: CGAffineTransform)] = []
            var lastPosition = 0.0
            
            for fold in sortedFolds {
                segments.append((start: lastPosition, end: fold.position, transform: .identity))
                lastPosition = fold.position
            }
            segments.append((start: lastPosition, end: 1.0, transform: .identity))
            
            var currentX: CGFloat = 0
            
            for (index, segment) in segments.enumerated() {
                let segmentWidth = (segment.end - segment.start) * width
                let foldDepth = index < sortedFolds.count ? sortedFolds[index].depth : 0
                let isCrease = index < sortedFolds.count ? sortedFolds[index].isCrease : false
                
                let segmentPath = Path { path in
                    path.move(to: CGPoint(x: currentX, y: height * 0.5))
                    
                    if index < sortedFolds.count {
                        let controlOffset = segmentWidth * foldDepth * (isCrease ? -1 : 1)
                        path.addQuadCurve(
                            to: CGPoint(x: currentX + segmentWidth, y: height * 0.5),
                            control: CGPoint(x: currentX + segmentWidth * 0.5, y: height * 0.5 + controlOffset)
                        )
                    } else {
                        path.addLine(to: CGPoint(x: currentX + segmentWidth, y: height * 0.5))
                    }
                }
                
                context.stroke(segmentPath, with: .color(.black.opacity(0.3)), lineWidth: 1)
                
                let segmentEvents = sortedEvents.filter { event in
                    let eventPosition = event.date.timeIntervalSince(firstDate) / timespan
                    return eventPosition >= segment.start && eventPosition <= segment.end
                }
                
                for event in segmentEvents {
                    let eventPosition = event.date.timeIntervalSince(firstDate) / timespan
                    let localPosition = (eventPosition - segment.start) / (segment.end - segment.start)
                    
                    var eventX = currentX + localPosition * segmentWidth
                    var eventY = height * 0.5
                    
                    if index < sortedFolds.count {
                        let t = localPosition
                        let controlOffset = segmentWidth * foldDepth * (isCrease ? -1 : 1)
                        eventY = height * 0.5 + 2 * t * (1 - t) * controlOffset
                    }
                    
                    let radius = 3 + event.significance * 5
                    let opacity = selectedEvent?.id == event.id ? 1.0 : 0.6
                    
                    context.fill(
                        Circle().path(in: CGRect(x: eventX - radius, y: eventY - radius, width: radius * 2, height: radius * 2)),
                        with: .color(.black.opacity(opacity))
                    )
                    
                    if selectedEvent?.id == event.id || event.significance > 0.7 {
                        let text = Text(event.title)
                            .font(.system(size: 10))
                            .foregroundColor(.black.opacity(0.7))
                        
                        let textSize = CGSize(width: 100, height: 20)
                        let textPoint = CGPoint(x: eventX - textSize.width / 2, y: eventY + radius + 4)
                        
                        context.draw(text, at: textPoint)
                    }
                }
                
                currentX += segmentWidth
            }
        }
        .frame(width: width, height: height)
        .gesture(
            DragGesture()
                .onChanged { value in
                    let position = value.location.x / width
                    if let nearestFold = foldPoints.min(by: { abs($0.position - position) < abs($1.position - position) }) {
                        if abs(nearestFold.position - position) < 0.05 {
                            withAnimation(.interactiveSpring()) {
                                if let index = foldPoints.firstIndex(where: { $0.id == nearestFold.id }) {
                                    foldPoints[index].position = position.clamped(to: 0...1)
                                }
                            }
                        }
                    }
                }
        )
    }
}

extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        return min(max(self, range.lowerBound), range.upperBound)
    }
}