struct ContentView: View {
    @StateObject private var terrainData = TerrainData()
    @State private var viewAngle: Double = -20
    @State private var timeScale: TimeScale = .week
    @State private var hoveredSection: Date?
    @State private var selectedMemory: MemoryFlag?
    @State private var isAddingEntry = false
    @State private var newEntryMood: Double = 0.5
    @State private var newEntryNote: String = ""
    
    var body: some View {
        ZStack {
            // Deep earth gradient background
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.05, blue: 0.08),
                    Color(red: 0.08, green: 0.06, blue: 0.10)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            
            VStack(spacing: 0) {
                // Control ridge
                HStack(spacing: 24) {
                    Text("Emotional Altitude")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.white.opacity(0.6))
                    
                    Spacer()
                    
                    HStack(spacing: 16) {
                        ForEach(TimeScale.allCases, id: \.self) { scale in
                            Text(scale.label)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(timeScale == scale ? .white : .white.opacity(0.4))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(
                                    Capsule()
                                        .fill(timeScale == scale ? Color.white.opacity(0.1) : Color.clear)
                                )
                                .onTapGesture {
                                    withAnimation(.easeInOut(duration: 0.3)) {
                                        timeScale = scale
                                    }
                                }
                        }
                    }
                    
                    Button(action: { isAddingEntry = true }) {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 18))
                            .foregroundColor(.white.opacity(0.6))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 32)
                .padding(.vertical, 20)
                
                // Terrain viewport
                GeometryReader { geometry in
                    ZStack {
                        TerrainView(
                            data: terrainData,
                            timeScale: timeScale,
                            viewAngle: viewAngle,
                            hoveredSection: $hoveredSection,
                            selectedMemory: $selectedMemory,
                            size: geometry.size
                        )
                        
                        // Weather overlay
                        WeatherOverlay(
                            data: terrainData,
                            size: geometry.size
                        )
                        .allowsHitTesting(false)
                        
                        // Memory detail
                        if let memory = selectedMemory {
                            MemoryDetailView(memory: memory)
                                .position(
                                    x: geometry.size.width * 0.75,
                                    y: geometry.size.height * 0.3
                                )
                                .transition(.asymmetric(
                                    insertion: .scale(scale: 0.8).combined(with: .opacity),
                                    removal: .scale(scale: 0.9).combined(with: .opacity)
                                ))
                        }
                    }
                }
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            viewAngle = max(-45, min(0, viewAngle + value.translation.width * 0.1))
                        }
                )
                
                // Elevation legend
                HStack(spacing: 32) {
                    ForEach(EmotionalStrata.allCases, id: \.self) { stratum in
                        HStack(spacing: 8) {
                            Circle()
                                .fill(stratum.color)
                                .frame(width: 8, height: 8)
                            Text(stratum.label)
                                .font(.system(size: 11))
                                .foregroundColor(.white.opacity(0.5))
                        }
                    }
                }
                .padding(.vertical, 16)
            }
            
            if isAddingEntry {
                EntrySheet(
                    mood: $newEntryMood,
                    note: $newEntryNote,
                    isPresented: $isAddingEntry,
                    onSave: {
                        terrainData.addEntry(mood: newEntryMood, note: newEntryNote)
                        newEntryMood = 0.5
                        newEntryNote = ""
                    }
                )
            }
        }
        .frame(width: 1440, height: 900)
    }
}

struct TerrainView: View {
    let data: TerrainData
    let timeScale: TimeScale
    let viewAngle: Double
    @Binding var hoveredSection: Date?
    @Binding var selectedMemory: MemoryFlag?
    let size: CGSize
    
    var body: some View {
        Canvas { context, size in
            let sections = data.getSections(for: timeScale)
            let sectionWidth = size.width / CGFloat(sections.count)
            
            // Draw terrain layers
            for (index, section) in sections.enumerated() {
                let x = CGFloat(index) * sectionWidth
                let height = section.averageMood * size.height * 0.7
                let centerY = size.height * 0.6
                
                // Calculate perspective transformation
                let perspectiveFactor = 1.0 - (abs(viewAngle) / 45.0) * 0.3
                let adjustedHeight = height * perspectiveFactor
                let yOffset = sin(viewAngle * .pi / 180) * 100
                
                // Draw stratified layers
                for stratum in EmotionalStrata.allCases.reversed() {
                    if section.averageMood >= stratum.threshold {
                        let stratumHeight = (section.averageMood - stratum.threshold) * size.height * 0.7
                        
                        let path = Path { path in
                            path.move(to: CGPoint(x: x, y: centerY + yOffset))
                            path.addQuadCurve(
                                to: CGPoint(x: x + sectionWidth, y: centerY + yOffset),
                                control: CGPoint(x: x + sectionWidth/2, y: centerY - adjustedHeight + yOffset)
                            )
                            path.addLine(to: CGPoint(x: x + sectionWidth, y: size.height))
                            path.addLine(to: CGPoint(x: x, y: size.height))
                            path.closeSubpath()
                        }
                        
                        context.fill(
                            path,
                            with: .linearGradient(
                                Gradient(colors: [
                                    stratum.color.opacity(0.8),
                                    stratum.color.opacity(0.4)
                                ]),
                                startPoint: CGPoint(x: x + sectionWidth/2, y: centerY - adjustedHeight),
                                endPoint: CGPoint(x: x + sectionWidth/2, y: size.height)
                            )
                        )
                    }
                }
                
                // Draw memory flags
                for memory in section.memories {
                    let flagX = x + sectionWidth/2
                    let flagY = centerY - adjustedHeight + yOffset - 20
                    
                    context.fill(
                        Path(ellipse: CGRect(x: flagX - 4, y: flagY - 4, width: 8, height: 8)),
                        with: .color(.white.opacity(0.9))
                    )
                    
                    let flagPath = Path { path in
                        path.move(to: CGPoint(x: flagX, y: flagY))
                        path.addLine(to: CGPoint(x: flagX, y: flagY - 30))
                        path.addLine(to: CGPoint(x: flagX + 15, y: flagY - 25))
                        path.addLine(to: CGPoint(x: flagX, y: flagY - 20))
                    }
                    
                    context.stroke(
                        flagPath,
                        with: .color(.white.opacity(0.7)),
                        lineWidth: 1.5
                    )
                }
            }
        }
        .onContinuousHover { phase in
            switch phase {
            case .active(let location):
                let sections = data.getSections(for: timeScale)
                let sectionWidth = size.width / CGFloat(sections.count)
                let index = Int(location.x / sectionWidth)
                if index >= 0 && index < sections.count {
                    hoveredSection = sections[index].date
                }
            case .ended:
                hoveredSection = nil
            }
        }
        .onTapGesture { location in
            let sections = data.getSections(for: timeScale)
            let sectionWidth = size.width / CGFloat(sections.count)
            let index = Int(location.x / sectionWidth)
            if index >= 0 && index < sections.count {
                if let memory = sections[index].memories.first {
                    withAnimation(.easeOut(duration: 0.3)) {
                        selectedMemory = memory
                    }
                }
            }
        }
    }
}

struct WeatherOverlay: View {
    let data: TerrainData
    let size: CGSize
    
    var body: some View {
        Canvas { context, size in
            let volatileSections = data.getVolatileSections()
            
            for section in volatileSections {
                if section.volatility > 0.6 {
                    // Storm clouds
                    let cloudY = size.height * 0.2
                    let cloudX = size.width * CGFloat(section.relativePosition)
                    
                    for i in 0..<3 {
                        let offset = CGFloat(i - 1) * 40
                        let cloud = Path(ellipse: CGRect(
                            x: cloudX + offset - 60,
                            y: cloudY - 20,
                            width: 120,
                            height: 60
                        ))
                        
                        context.fill(
                            cloud,
                            with: .color(.white.opacity(0.1 + section.volatility * 0.2))
                        )
                    }
                    
                    // Lightning
                    if section.volatility > 0.8 {
                        let lightningPath = Path { path in
                            path.move(to: CGPoint(x: cloudX, y: cloudY))
                            path.addLine(to: CGPoint(x: cloudX - 10, y: cloudY + 40))
                            path.addLine(to: CGPoint(x: cloudX + 5, y: cloudY + 45))
                            path.addLine(to: CGPoint(x: cloudX - 5, y: cloudY + 80))
                        }
                        
                        context.stroke(
                            lightningPath,
                            with: .color(.white.opacity(0.6)),
                            lineWidth: 2
                        )
                    }
                }
            }
        }
    }
}

struct MemoryDetailView: View {
    let memory: MemoryFlag
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(memory.date.formatted(date: .abbreviated, time: .omitted))
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.white.opacity(0.5))
            
            Text(memory.note)
                .font(.system(size: 14))
                .foregroundColor(.white.opacity(0.9))
                .lineLimit(4)
                .multilineTextAlignment(.leading)
            
            HStack(spacing: 8) {
                Circle()
                    .fill(memory.mood.stratum.color)
                    .frame(width: 6, height: 6)
                Text(memory.mood.stratum.label)
                    .font(.system(size: 11))
                    .foregroundColor(.white.opacity(0.7))
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.black.opacity(0.8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                )
        )
        .frame(width: 280)
    }
}

struct EntrySheet: View {
    @Binding var mood: Double
    @Binding var note: String
    @Binding var isPresented: Bool
    let onSave: () -> Void
    
    var body: some View {
        ZStack {
            Color.black.opacity(0.6)
                .ignoresSafeArea()
                .onTapGesture {
                    isPresented = false
                }
            
            VStack(spacing: 24) {
                Text("How are you feeling?")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundColor(.white.opacity(0.9))
                
                VStack(spacing: 16) {
                    HStack {
                        Image(systemName: "cloud.rain")
                            .foregroundColor(.white.opacity(0.4))
                        
                        Slider(value: $mood, in: 0...1)
                            .accentColor(.white)
                        
                        Image(systemName: "sun.max")
                            .foregroundColor(.white.opacity(0.4))
                    }
                    
                    Text(mood.stratum.label)
                        .font(.system(size: 14))
                        .foregroundColor(mood.stratum.color)
                }
                
                VStack(alignment: .leading, spacing: 8) {
                    Text("Add a note (optional)")
                        .font(.system(size: 13))
                        .foregroundColor(.white.opacity(0.6))
                    
                    TextEditor(text: $note)
                        .font(.system(size: 14))
                        .foregroundColor(.white)
                        .scrollContentBackground(.hidden)
                        .background(Color.white.opacity(0.05))
                        .cornerRadius(8)
                        .frame(height: 100)
                }
                
                HStack(spacing: 16) {
                    Button("Cancel") {
                        isPresented = false
                    }
                    .buttonStyle(.plain)
                    .foregroundColor(.white.opacity(0.6))
                    
                    Button("Save") {
                        onSave()
                        isPresented = false
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 8)
                    .background(Color.white.opacity(0.1))
                    .cornerRadius(6)
                    .foregroundColor(.white)
                }
            }
            .padding(32)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(red: 0.1, green: 0.1, blue: 0.12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.white.opacity(0.1), lineWidth: 1)
                    )
            )
            .frame(width: 400)
        }
    }
}

enum TimeScale: CaseIterable {
    case week, month, year
    
    var label: String {
        switch self {
        case .week: return "Week"
        case .month: return "Month"
        case .year: return "Year"
        }
    }
}

enum EmotionalStrata: CaseIterable {
    case depths, valleys, plains, foothills, peaks, summit
    
    var threshold: Double {
        switch self {
        case .depths: return 0.0
        case .valleys: return 0.15
        case .plains: return 0.35
        case .foothills: return 0.5
        case .peaks: return 0.7
        case .summit: return 0.85
        }
    }
    
    var label: String {
        switch self {
        case .depths: return "Depths"
        case .valleys: return "Valleys"
        case .plains: return "Plains"
        case .foothills: return "Foothills"
        case .peaks: return "Peaks"
        case .summit: return "Summit"
        }
    }
    
    var color: Color {
        switch self {
        case .depths: return Color(red: 0.2, green: 0.3, blue: 0.5)
        case .valleys: return Color(red: 0.3, green: 0.4, blue: 0.6)
        case .plains: return Color(red: 0.5, green: 0.6, blue: 0.5)
        case .foothills: return Color(red: 0.7, green: 0.7, blue: 0.4)
        case .peaks: return Color(red: 0.9, green: 0.6, blue: 0.3)
        case .summit: return Color(red: 1.0, green: 0.8, blue: 0.4)
        }
    }
}

extension Double {
    var stratum: EmotionalStrata {
        for stratum in EmotionalStrata.allCases.reversed() {
            if self >= stratum.threshold {
                return stratum
            }
        }
        return .depths
    }
}

struct TerrainSection {
    let date: Date
    let entries: [EmotionalEntry]
    let relativePosition: Double
    
    var averageMood: Double {
        entries.isEmpty ? 0.5 : entries.map(\.mood).reduce(0, +) / Double(entries.count)
    }
    
    var volatility: Double {
        guard entries.count > 1 else { return 0 }
        let moods = entries.map(\.mood)
        let mean = averageMood
        let variance = moods.map { pow($0 - mean, 2) }.reduce(0, +) / Double(moods.count)
        return sqrt(variance)
    }
    
    var memories: [MemoryFlag] {
        entries.compactMap { entry in
            if !entry.note.isEmpty && (entry.mood > 0.8 || entry.mood < 0.2) {
                return MemoryFlag(date: entry.date, mood: entry.mood, note: entry.note)
            }
            return nil
        }
    }
}

struct EmotionalEntry {
    let date: Date
    let mood: Double
    let note: String
}

struct MemoryFlag: Identifiable {
    let id = UUID()
    let date: Date
    let mood: Double
    let note: String
}

class TerrainData: ObservableObject {
    @Published private var entries: [EmotionalEntry] = []
    
    init() {
        generateSampleData()
    }
    
    func addEntry(mood: Double, note: String) {
        entries.append(EmotionalEntry(date: Date(), mood: mood, note: note))
    }
    
    func getSections(for scale: TimeScale) -> [TerrainSection] {
        let calendar = Calendar.current
        let now = Date()
        var sections: [TerrainSection] = []
        
        let dayCount: Int
        switch scale {
        case .week: dayCount = 7
        case .month: dayCount = 30
        case .year: dayCount = 365
        }
        
        for i in 0..<min(dayCount, 50) {
            if let date = calendar.date(byAdding: .day, value: -i, to: now) {
                let dayEntries = entries.filter {
                    calendar.isDate($0.date, inSameDayAs: date)
                }
                
                sections.append(TerrainSection(
                    date: date,
                    entries: dayEntries,
                    relativePosition: Double(i) / Double(dayCount)
                ))
            }
        }
        
        return sections.reversed()
    }
    
    func getVolatileSections() -> [TerrainSection] {
        getSections(for: .month).filter { $0.volatility > 0.3 }
    }
    
    private func generateSampleData() {
        let calendar = Calendar.current
        let now = Date()
        
        for i in 0..<60 {
            if let date = calendar.date(byAdding: .day, value: -i, to: now) {
                let baseMood = sin(Double(i) * 0.1) * 0.3 + 0.5
                let variation = Double.random(in: -0.2...0.2)
                let mood = max(0, min(1, baseMood + variation))
                
                var note = ""
                if mood > 0.85 {
                    note = ["Amazing day!", "Everything clicked", "Pure joy", "Breakthrough moment"].randomElement()!
                } else if mood < 0.2 {
                    note = ["Tough day", "Struggling", "Need rest", "Heavy thoughts"].randomElement()!
                }
                
                entries.append(EmotionalEntry(date: date, mood: mood, note: note))
                
                if Double.random(in: 0...1) > 0.7 {
                    let secondMood = max(0, min(1, mood + Double.random(in: -0.4...0.4)))
                    entries.append(EmotionalEntry(date: date, mood: secondMood, note: ""))
                }
            }
        }
    }
}