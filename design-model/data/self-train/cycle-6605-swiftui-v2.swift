struct ContentView: View {
    @State private var calendarDays: [CalendarDay] = []
    @State private var selectedDay: CalendarDay?
    @State private var memoryFragments: [MemoryFragment] = []
    @State private var draggingFragment: MemoryFragment?
    @State private var hoveredDay: UUID?
    @State private var expandedDays: Set<UUID> = []
    
    let adaptiveColumns = [
        GridItem(.adaptive(minimum: 200, maximum: 300), spacing: 24)
    ]
    
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.96, green: 0.95, blue: 0.94),
                    Color(red: 0.92, green: 0.91, blue: 0.90)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            
            HStack(spacing: 0) {
                // Memory fragments panel
                VStack(alignment: .leading, spacing: 0) {
                    Text("Memory Fragments")
                        .font(.system(size: 24, weight: .semibold, design: .serif))
                        .foregroundColor(Color(red: 0.15, green: 0.15, blue: 0.18))
                        .padding(.horizontal, 32)
                        .padding(.vertical, 40)
                    
                    ScrollView {
                        VStack(spacing: 20) {
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
                        .padding(.horizontal, 32)
                        .padding(.bottom, 40)
                    }
                }
                .frame(width: 380)
                .background(
                    Color.white.opacity(0.5)
                        .background(.ultraThinMaterial)
                )
                
                // Calendar grid
                ScrollView {
                    LazyVGrid(columns: adaptiveColumns, spacing: 24) {
                        ForEach(calendarDays) { day in
                            CalendarDayView(
                                day: day,
                                isHovered: hoveredDay == day.id,
                                isExpanded: expandedDays.contains(day.id)
                            )
                            .onDrop(of: [.text], isTargeted: { isTargeted in
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    hoveredDay = isTargeted ? day.id : nil
                                }
                            }) { providers in
                                handleDrop(on: day, providers: providers)
                                return true
                            }
                            .onTapGesture {
                                withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                                    if expandedDays.contains(day.id) {
                                        expandedDays.remove(day.id)
                                    } else {
                                        expandedDays.insert(day.id)
                                    }
                                }
                            }
                        }
                    }
                    .padding(48)
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
        
        for dayOffset in -15...15 {
            if let date = calendar.date(byAdding: .day, value: dayOffset, to: today) {
                let day = CalendarDay(
                    id: UUID(),
                    date: date,
                    memories: []
                )
                calendarDays.append(day)
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
            "Cooking Sunday dinner"
        ]
        
        memoryFragments = fragmentTexts.enumerated().map { index, text in
            MemoryFragment(
                id: UUID(),
                text: text,
                color: memoryColors[index % memoryColors.count],
                strength: Double.random(in: 0.6...1.0)
            )
        }
    }
    
    let memoryColors = [
        Color(red: 0.91, green: 0.71, blue: 0.66),
        Color(red: 0.73, green: 0.82, blue: 0.88),
        Color(red: 0.89, green: 0.84, blue: 0.69),
        Color(red: 0.78, green: 0.85, blue: 0.78),
        Color(red: 0.85, green: 0.73, blue: 0.87),
        Color(red: 0.94, green: 0.81, blue: 0.72),
        Color(red: 0.70, green: 0.78, blue: 0.83),
        Color(red: 0.87, green: 0.87, blue: 0.75)
    ]
    
    func handleDrop(on day: CalendarDay, providers: [NSItemProvider]) -> Bool {
        guard let fragment = draggingFragment,
              let dayIndex = calendarDays.firstIndex(where: { $0.id == day.id }) else { return false }
        
        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
            var updatedDay = calendarDays[dayIndex]
            updatedDay.memories.append(fragment)
            calendarDays[dayIndex] = updatedDay
            
            if let fragmentIndex = memoryFragments.firstIndex(where: { $0.id == fragment.id }) {
                memoryFragments.remove(at: fragmentIndex)
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
    let color: Color
    let strength: Double
}

struct CalendarDayView: View {
    let day: CalendarDay
    let isHovered: Bool
    let isExpanded: Bool
    
    var dateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateFormat = "d"
        return formatter
    }
    
    var monthFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM"
        return formatter
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(dateFormatter.string(from: day.date))
                        .font(.system(size: isExpanded ? 28 : 24, weight: .bold, design: .serif))
                        .foregroundColor(Color(red: 0.15, green: 0.15, blue: 0.18))
                    
                    Text(monthFormatter.string(from: day.date).uppercased())
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(Color(red: 0.4, green: 0.4, blue: 0.45))
                }
                
                Spacer()
                
                if !day.memories.isEmpty {
                    Text("\(day.memories.count)")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Color(red: 0.15, green: 0.15, blue: 0.18))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(
                            Capsule()
                                .fill(Color.white.opacity(0.8))
                        )
                }
            }
            
            if isExpanded && !day.memories.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(day.memories) { memory in
                        HStack {
                            Circle()
                                .fill(memory.color)
                                .frame(width: 8, height: 8)
                            
                            Text(memory.text)
                                .font(.system(size: 14))
                                .foregroundColor(Color(red: 0.25, green: 0.25, blue: 0.3))
                                .lineLimit(1)
                        }
                        .padding(.vertical, 4)
                    }
                }
                .padding(.top, 8)
            }
        }
        .padding(20)
        .frame(height: isExpanded ? nil : 100)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.white.opacity(day.memories.isEmpty ? 0.3 : 0.6))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(
                            LinearGradient(
                                colors: day.memories.isEmpty ? 
                                    [Color.white.opacity(0.5), Color.white.opacity(0.3)] :
                                    [day.memories.first?.color.opacity(0.3) ?? Color.clear, Color.white.opacity(0.3)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 1
                        )
                )
                .shadow(color: Color.black.opacity(isHovered ? 0.1 : 0.05), radius: isHovered ? 12 : 8, y: 4)
        )
        .scaleEffect(isHovered ? 1.02 : 1.0)
    }
}

struct MemoryFragmentView: View {
    let fragment: MemoryFragment
    let isDragging: Bool
    
    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 8)
                .fill(
                    LinearGradient(
                        colors: [fragment.color, fragment.color.opacity(0.7)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: 4, height: 40)
            
            VStack(alignment: .leading, spacing: 4) {
                Text(fragment.text)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(Color(red: 0.15, green: 0.15, blue: 0.18))
                
                HStack(spacing: 4) {
                    ForEach(0..<5) { i in
                        Circle()
                            .fill(Color(red: 0.4, green: 0.4, blue: 0.45).opacity(
                                Double(i) < fragment.strength * 5 ? 1.0 : 0.2
                            ))
                            .frame(width: 4, height: 4)
                    }
                }
            }
            
            Spacer()
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.white.opacity(0.8))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(fragment.color.opacity(0.2), lineWidth: 1)
                )
                .shadow(color: Color.black.opacity(isDragging ? 0.15 : 0.05), radius: isDragging ? 8 : 4, y: 2)
        )
        .opacity(isDragging ? 0.5 : 1.0)
        .scaleEffect(isDragging ? 0.95 : 1.0)
    }
}