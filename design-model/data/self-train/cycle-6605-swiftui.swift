struct ContentView: View {
    @State private var calendarDays: [CalendarDay] = []
    @State private var selectedDay: CalendarDay?
    @State private var memoryFragments: [MemoryFragment] = []
    @State private var draggingFragment: MemoryFragment?
    @State private var dragOffset: CGSize = .zero
    @State private var hoveredDay: UUID?
    @State private var paperTextures: [UUID: PaperState] = [:]
    
    let columns = Array(repeating: GridItem(.fixed(180), spacing: 12), count: 7)
    
    var body: some View {
        ZStack {
            Color(red: 0.94, green: 0.92, blue: 0.89)
                .ignoresSafeArea()
            
            HStack(spacing: 0) {
                // Memory fragments panel
                VStack(alignment: .leading, spacing: 20) {
                    Text("Memory Fragments")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundColor(.black.opacity(0.8))
                        .padding(.horizontal, 24)
                        .padding(.top, 32)
                    
                    ScrollView {
                        VStack(spacing: 16) {
                            ForEach(memoryFragments) { fragment in
                                MemoryFragmentView(
                                    fragment: fragment,
                                    isDragging: draggingFragment?.id == fragment.id
                                )
                                .onDrag {
                                    self.draggingFragment = fragment
                                    return NSItemProvider(object: fragment.id.uuidString as NSString)
                                }
                            }
                        }
                        .padding(.horizontal, 24)
                    }
                    
                    Spacer()
                }
                .frame(width: 320)
                .background(Color.white.opacity(0.4))
                
                // Calendar grid
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(calendarDays) { day in
                            CalendarDayView(
                                day: day,
                                paperState: paperTextures[day.id] ?? PaperState(),
                                isHovered: hoveredDay == day.id
                            )
                            .onDrop(of: [.text], isTargeted: { isTargeted in
                                hoveredDay = isTargeted ? day.id : nil
                            }) { providers in
                                handleDrop(on: day, providers: providers)
                                return true
                            }
                            .onTapGesture {
                                selectedDay = day
                            }
                        }
                    }
                    .padding(40)
                }
            }
            
            // Selected day detail overlay
            if let day = selectedDay {
                DayDetailView(day: day, paperState: paperTextures[day.id] ?? PaperState()) {
                    selectedDay = nil
                }
            }
        }
        .onAppear {
            initializeCalendar()
            generateMemoryFragments()
        }
    }
    
    func initializeCalendar() {
        let calendar = Calendar.current
        let today = Date()
        
        for dayOffset in -30...30 {
            if let date = calendar.date(byAdding: .day, value: dayOffset, to: today) {
                let day = CalendarDay(
                    id: UUID(),
                    date: date,
                    memories: []
                )
                calendarDays.append(day)
                paperTextures[day.id] = PaperState()
            }
        }
    }
    
    func generateMemoryFragments() {
        let fragmentTexts = [
            "Morning coffee ritual",
            "First day at new job",
            "Weekend garden walk",
            "Birthday celebration",
            "Phone call with mom",
            "Sunset at the beach",
            "Reading in the park",
            "Cooking Sunday dinner",
            "Movie night",
            "Doctor appointment",
            "Lunch with friend",
            "Grocery shopping"
        ]
        
        memoryFragments = fragmentTexts.map { text in
            MemoryFragment(
                id: UUID(),
                text: text,
                imageData: generateFragmentImage(),
                strength: Double.random(in: 0.3...1.0)
            )
        }
    }
    
    func generateFragmentImage() -> [CGFloat] {
        return (0..<9).map { _ in CGFloat.random(in: 0.2...0.8) }
    }
    
    func handleDrop(on day: CalendarDay, providers: [NSItemProvider]) -> Bool {
        guard let fragment = draggingFragment else { return false }
        
        withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
            if let index = calendarDays.firstIndex(where: { $0.id == day.id }) {
                calendarDays[index].memories.append(fragment)
                
                // Update paper state based on memory strength
                var state = paperTextures[day.id] ?? PaperState()
                state.updateWithMemory(strength: fragment.strength)
                paperTextures[day.id] = state
                
                // Remove fragment from available list
                memoryFragments.removeAll { $0.id == fragment.id }
            }
        }
        
        draggingFragment = nil
        return true
    }
}

struct CalendarDay: Identifiable {
    let id: UUID
    let date: Date
    var memories: [MemoryFragment]
}

struct MemoryFragment: Identifiable {
    let id: UUID
    let text: String
    let imageData: [CGFloat]
    let strength: Double
}

struct PaperState {
    var tears: [(position: CGPoint, size: CGFloat)] = []
    var burns: [(position: CGPoint, intensity: CGFloat)] = []
    var opacity: Double = 0.7
    var crumpleAmount: Double = 0.3
    
    mutating func updateWithMemory(strength: Double) {
        opacity = min(1.0, opacity + strength * 0.2)
        crumpleAmount = max(0, crumpleAmount - strength * 0.15)
        
        if strength < 0.5 {
            // Add tears for weak memories
            tears.append((
                position: CGPoint(x: CGFloat.random(in: 0.2...0.8), y: CGFloat.random(in: 0.2...0.8)),
                size: CGFloat.random(in: 0.05...0.15)
            ))
        }
        
        if strength < 0.3 {
            // Add burns for very weak memories
            burns.append((
                position: CGPoint(x: CGFloat.random(in: 0.1...0.9), y: CGFloat.random(in: 0.1...0.9)),
                intensity: CGFloat.random(in: 0.3...0.7)
            ))
        }
    }
}

struct CalendarDayView: View {
    let day: CalendarDay
    let paperState: PaperState
    let isHovered: Bool
    
    var body: some View {
        ZStack {
            // Paper background with damage
            PaperView(state: paperState)
                .frame(width: 180, height: 200)
                .overlay(
                    VStack(alignment: .leading, spacing: 8) {
                        Text(dayFormatter.string(from: day.date))
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.black.opacity(0.8))
                        
                        if !day.memories.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                ForEach(day.memories.prefix(3)) { memory in
                                    HStack(spacing: 4) {
                                        FragmentThumbnail(imageData: memory.imageData)
                                            .frame(width: 20, height: 20)
                                        
                                        Text(memory.text)
                                            .font(.system(size: 11))
                                            .foregroundColor(.black.opacity(0.6))
                                            .lineLimit(1)
                                    }
                                }
                            }
                        }
                        
                        Spacer()
                    }
                    .padding(12)
                )
                .scaleEffect(isHovered ? 1.02 : 1.0)
                .animation(.easeOut(duration: 0.2), value: isHovered)
        }
    }
    
    var dayFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d"
        return formatter
    }
}

struct PaperView: View {
    let state: PaperState
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Base paper
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.white.opacity(state.opacity))
                    .overlay(
                        // Paper texture
                        Canvas { context, size in
                            // Crumple effect
                            for i in 0..<Int(state.crumpleAmount * 20) {
                                let x = CGFloat.random(in: 0...size.width)
                                let y = CGFloat.random(in: 0...size.height)
                                let path = Path { p in
                                    p.move(to: CGPoint(x: x, y: y))
                                    p.addLine(to: CGPoint(
                                        x: x + CGFloat.random(in: -20...20),
                                        y: y + CGFloat.random(in: -20...20)
                                    ))
                                }
                                context.stroke(path, with: .color(.gray.opacity(0.1)), lineWidth: 0.5)
                            }
                            
                            // Tears
                            for tear in state.tears {
                                let x = tear.position.x * size.width
                                let y = tear.position.y * size.height
                                let tearSize = tear.size * min(size.width, size.height)
                                
                                let tearPath = Path { p in
                                    p.move(to: CGPoint(x: x, y: y))
                                    for _ in 0..<8 {
                                        p.addLine(to: CGPoint(
                                            x: x + CGFloat.random(in: -tearSize...tearSize),
                                            y: y + CGFloat.random(in: -tearSize...tearSize)
                                        ))
                                    }
                                }
                                context.fill(tearPath, with: .color(.black.opacity(0.8)))
                            }
                            
                            // Burns
                            for burn in state.burns {
                                let x = burn.position.x * size.width
                                let y = burn.position.y * size.height
                                
                                let gradient = Gradient(colors: [
                                    Color(red: 0.4, green: 0.3, blue: 0.2).opacity(burn.intensity),
                                    Color(red: 0.6, green: 0.4, blue: 0.3).opacity(burn.intensity * 0.5),
                                    Color.clear
                                ])
                                
                                context.fill(
                                    Circle().path(in: CGRect(
                                        x: x - 15,
                                        y: y - 15,
                                        width: 30,
                                        height: 30
                                    )),
                                    with: .radialGradient(
                                        gradient,
                                        center: .center,
                                        startRadius: 0,
                                        endRadius: 15
                                    )
                                )
                            }
                        }
                    )
                
                // Shadow
                RoundedRectangle(cornerRadius: 4)
                    .stroke(Color.black.opacity(0.1), lineWidth: 1)
            }
        }
    }
}

struct MemoryFragmentView: View {
    let fragment: MemoryFragment
    let isDragging: Bool
    
    var body: some View {
        HStack(spacing: 12) {
            FragmentThumbnail(imageData: fragment.imageData)
                .frame(width: 60, height: 60)
            
            VStack(alignment: .leading, spacing: 4) {
                Text(fragment.text)
                    .font(.system(size: 14))
                    .foregroundColor(.black.opacity(0.8))
                
                StrengthIndicator(strength: fragment.strength)
            }
            
            Spacer()
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.white.opacity(0.8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.gray.opacity(0.3), lineWidth: 1)
                )
        )
        .opacity(isDragging ? 0.5 : 1.0)
        .scaleEffect(isDragging ? 0.95 : 1.0)
    }
}

struct FragmentThumbnail: View {
    let imageData: [CGFloat]
    
    var body: some View {
        Canvas { context, size in
            let gridSize = 3
            let cellSize = size.width / CGFloat(gridSize)
            
            for i in 0..<gridSize {
                for j in 0..<gridSize {
                    let index = i * gridSize + j
                    if index < imageData.count {
                        let brightness = imageData[index]
                        context.fill(
                            Rectangle().path(in: CGRect(
                                x: CGFloat(j) * cellSize,
                                y: CGFloat(i) * cellSize,
                                width: cellSize,
                                height: cellSize
                            )),
                            with: .color(.gray.opacity(1.0 - brightness))
                        )
                    }
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 4))
    }
}

struct StrengthIndicator: View {
    let strength: Double
    
    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<5) { i in
                Circle()
                    .fill(i < Int(strength * 5) ? Color.black.opacity(0.7) : Color.gray.opacity(0.3))
                    .frame(width: 4, height: 4)
            }
        }
    }
}

struct DayDetailView: View {
    let day: CalendarDay
    let paperState: PaperState
    let onDismiss: () -> Void
    
    var body: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture {
                    onDismiss()
                }
            
            VStack(spacing: 24) {
                HStack {
                    Text(dateFormatter.string(from: day.date))
                        .font(.system(size: 24, weight: .medium))
                    
                    Spacer()
                    
                    Button(action: onDismiss) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 24))
                            .foregroundColor(.gray)
                    }
                    .buttonStyle(.plain)
                }
                
                PaperView(state: paperState)
                    .frame(height: 400)
                    .overlay(
                        VStack(alignment: .leading, spacing: 16) {
                            ForEach(day.memories) { memory in
                                HStack(spacing: 16) {
                                    FragmentThumbnail(imageData: memory.imageData)
                                        .frame(width: 80, height: 80)
                                    
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text(memory.text)
                                            .font(.system(size: 18))
                                        
                                        StrengthIndicator(strength: memory.strength)
                                    }
                                    
                                    Spacer()
                                }
                                .padding()
                                .background(Color.white.opacity(0.5))
                                .cornerRadius(8)
                            }
                            
                            Spacer()
                        }
                        .padding()
                    )
            }
            .padding(40)
            .background(Color.white)
            .cornerRadius(16)
            .frame(width: 600)
        }
    }
    
    var dateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateStyle = .long
        return formatter
    }
}