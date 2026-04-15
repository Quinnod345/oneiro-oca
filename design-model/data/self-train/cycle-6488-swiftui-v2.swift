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
            Color(red: 0.05, green: 0.05, blue: 0.08)
                .ignoresSafeArea()
            
            VStack(spacing: 0) {
                // Header
                HStack {
                    Text("Emotional Altitude")
                        .font(.system(size: 24, weight: .semibold, design: .rounded))
                        .foregroundColor(.white)
                    
                    Spacer()
                    
                    HStack(spacing: 4) {
                        ForEach(TimeScale.allCases, id: \.self) { scale in
                            Button(action: {
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    timeScale = scale
                                }
                            }) {
                                Text(scale.label)
                                    .font(.system(size: 14, weight: .medium, design: .rounded))
                                    .foregroundColor(timeScale == scale ? .white : Color(white: 0.6))
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 8)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(timeScale == scale ? Color.white.opacity(0.15) : Color.clear)
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    
                    Button(action: { isAddingEntry = true }) {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 24))
                            .foregroundColor(.white)
                            .opacity(0.8)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 16)
                
                // Main visualization
                GeometryReader { geometry in
                    ZStack {
                        // Simplified terrain view
                        TerrainView(
                            data: terrainData,
                            timeScale: timeScale,
                            viewAngle: viewAngle,
                            hoveredSection: $hoveredSection,
                            selectedMemory: $selectedMemory,
                            size: geometry.size
                        )
                        
                        // Memory detail overlay
                        if let memory = selectedMemory {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(memory.date, style: .date)
                                        .font(.system(size: 14, weight: .medium, design: .rounded))
                                        .foregroundColor(.white.opacity(0.7))
                                    
                                    Spacer()
                                    
                                    Button(action: { selectedMemory = nil }) {
                                        Image(systemName: "xmark.circle.fill")
                                            .foregroundColor(.white.opacity(0.5))
                                    }
                                    .buttonStyle(.plain)
                                }
                                
                                Text(memory.note)
                                    .font(.system(size: 16, design: .rounded))
                                    .foregroundColor(.white)
                                    .lineLimit(3)
                                
                                HStack {
                                    Circle()
                                        .fill(colorForMood(memory.value))
                                        .frame(width: 12, height: 12)
                                    Text(String(format: "%.0f%%", memory.value * 100))
                                        .font(.system(size: 14, weight: .medium, design: .rounded))
                                        .foregroundColor(.white.opacity(0.7))
                                }
                            }
                            .padding(16)
                            .background(
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(Color.white.opacity(0.1))
                                    .background(
                                        RoundedRectangle(cornerRadius: 12)
                                            .stroke(Color.white.opacity(0.2), lineWidth: 1)
                                    )
                            )
                            .frame(width: 280)
                            .position(
                                x: min(max(140, geometry.size.width * 0.75), geometry.size.width - 140),
                                y: geometry.size.height * 0.2
                            )
                            .transition(.asymmetric(
                                insertion: .scale(scale: 0.95).combined(with: .opacity),
                                removal: .scale(scale: 0.95).combined(with: .opacity)
                            ))
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 16)
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            viewAngle = max(-45, min(0, viewAngle + value.translation.width * 0.1))
                        }
                )
                
                // Legend
                HStack(spacing: 24) {
                    ForEach([(0.8, "High", Color(red: 0.4, green: 0.8, blue: 0.6)),
                             (0.5, "Neutral", Color(red: 0.6, green: 0.7, blue: 0.5)),
                             (0.2, "Low", Color(red: 0.7, green: 0.5, blue: 0.4))], id: \.0) { value, label, color in
                        HStack(spacing: 8) {
                            Circle()
                                .fill(color)
                                .frame(width: 12, height: 12)
                            Text(label)
                                .font(.system(size: 14, design: .rounded))
                                .foregroundColor(.white.opacity(0.7))
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 20)
            }
        }
        .sheet(isPresented: $isAddingEntry) {
            AddEntryView(
                mood: $newEntryMood,
                note: $newEntryNote,
                isPresented: $isAddingEntry,
                onSave: {
                    terrainData.addEntry(value: newEntryMood, note: newEntryNote)
                    newEntryMood = 0.5
                    newEntryNote = ""
                }
            )
        }
    }
    
    func colorForMood(_ value: Double) -> Color {
        if value > 0.66 {
            return Color(red: 0.4, green: 0.8, blue: 0.6)
        } else if value > 0.33 {
            return Color(red: 0.6, green: 0.7, blue: 0.5)
        } else {
            return Color(red: 0.7, green: 0.5, blue: 0.4)
        }
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
            let entries = data.getEntries(for: timeScale)
            guard !entries.isEmpty else { return }
            
            let width = size.width
            let height = size.height
            let sectionWidth = width / CGFloat(entries.count)
            
            // Draw terrain
            var path = Path()
            path.move(to: CGPoint(x: 0, y: height))
            
            for (index, entry) in entries.enumerated() {
                let x = CGFloat(index) * sectionWidth + sectionWidth / 2
                let y = height - (entry.value * height * 0.7 + height * 0.15)
                
                if index == 0 {
                    path.move(to: CGPoint(x: 0, y: y))
                }
                
                let controlX = x - sectionWidth / 2
                let controlY = y
                path.addQuadCurve(
                    to: CGPoint(x: x, y: y),
                    control: CGPoint(x: controlX, y: controlY)
                )
            }
            
            path.addLine(to: CGPoint(x: width, y: height))
            path.closeSubpath()
            
            // Fill gradient
            let gradient = Gradient(stops: [
                .init(color: Color(red: 0.4, green: 0.8, blue: 0.6).opacity(0.3), location: 0),
                .init(color: Color(red: 0.6, green: 0.7, blue: 0.5).opacity(0.2), location: 0.5),
                .init(color: Color(red: 0.7, green: 0.5, blue: 0.4).opacity(0.1), location: 1)
            ])
            
            context.fill(
                path,
                with: .linearGradient(
                    gradient,
                    startPoint: CGPoint(x: width/2, y: 0),
                    endPoint: CGPoint(x: width/2, y: height)
                )
            )
            
            // Draw line
            context.stroke(
                path,
                with: .color(.white.opacity(0.3)),
                lineWidth: 2
            )
            
            // Draw data points
            for (index, entry) in entries.enumerated() {
                let x = CGFloat(index) * sectionWidth + sectionWidth / 2
                let y = height - (entry.value * height * 0.7 + height * 0.15)
                
                let color = entry.value > 0.66 ? Color(red: 0.4, green: 0.8, blue: 0.6) :
                           entry.value > 0.33 ? Color(red: 0.6, green: 0.7, blue: 0.5) :
                                              Color(red: 0.7, green: 0.5, blue: 0.4)
                
                context.fill(
                    Circle().path(in: CGRect(x: x - 4, y: y - 4, width: 8, height: 8)),
                    with: .color(color)
                )
                
                // Memory flags
                if let memories = data.memories[entry.date], !memories.isEmpty {
                    context.fill(
                        Circle().path(in: CGRect(x: x - 6, y: y - 6, width: 12, height: 12)),
                        with: .color(.white.opacity(0.8))
                    )
                }
            }
        }
        .onTapGesture { location in
            let sectionWidth = size.width / CGFloat(data.getEntries(for: timeScale).count)
            let index = Int(location.x / sectionWidth)
            let entries = data.getEntries(for: timeScale)
            
            if index >= 0 && index < entries.count {
                let entry = entries[index]
                if let memories = data.memories[entry.date], let firstMemory = memories.first {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        selectedMemory = firstMemory
                    }
                }
            }
        }
    }
}

struct AddEntryView: View {
    @Binding var mood: Double
    @Binding var note: String
    @Binding var isPresented: Bool
    let onSave: () -> Void
    
    var body: some View {
        VStack(spacing: 24) {
            Text("New Entry")
                .font(.system(size: 24, weight: .semibold, design: .rounded))
                .foregroundColor(.white)
            
            VStack(alignment: .leading, spacing: 8) {
                Text("Mood")
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundColor(.white.opacity(0.7))
                
                HStack {
                    Text("😔")
                    Slider(value: $mood, in: 0...1)
                        .accentColor(colorForMood(mood))
                    Text("😊")
                }
            }
            
            VStack(alignment: .leading, spacing: 8) {
                Text("Note")
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundColor(.white.opacity(0.7))
                
                TextEditor(text: $note)
                    .font(.system(size: 16, design: .rounded))
                    .foregroundColor(.white)
                    .scrollContentBackground(.hidden)
                    .background(Color.white.opacity(0.1))
                    .cornerRadius(8)
                    .frame(minHeight: 100)
            }
            
            HStack(spacing: 16) {
                Button("Cancel") {
                    isPresented = false
                }
                .foregroundColor(.white.opacity(0.7))
                
                Button("Save") {
                    onSave()
                    isPresented = false
                }
                .foregroundColor(.white)
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .background(colorForMood(mood))
                .cornerRadius(8)
            }
            .font(.system(size: 16, weight: .medium, design: .rounded))
        }
        .padding(24)
        .background(Color(red: 0.05, green: 0.05, blue: 0.08))
        .presentationDetents([.height(400)])
    }
    
    func colorForMood(_ value: Double) -> Color {
        if value > 0.66 {
            return Color(red: 0.4, green: 0.8, blue: 0.6)
        } else if value > 0.33 {
            return Color(red: 0.6, green: 0.7, blue: 0.5)
        } else {
            return Color(red: 0.7, green: 0.5, blue: 0.4)
        }
    }
}

enum TimeScale: String, CaseIterable {
    case week = "Week"
    case month = "Month"
    case year = "Year"
    
    var label: String { rawValue }
}

struct MemoryFlag: Identifiable {
    let id = UUID()
    let date: Date
    let value: Double
    let note: String
}

class TerrainData: ObservableObject {
    @Published var entries: [TerrainEntry] = []
    @Published var memories: [Date: [MemoryFlag]] = [:]
    
    init() {
        // Generate sample data
        let calendar = Calendar.current
        let now = Date()
        
        for i in 0..<30 {
            if let date = calendar.date(byAdding: .day, value: -i, to: now) {
                let value = Double.random(in: 0.2...0.8) + sin(Double(i) * 0.3) * 0.2
                entries.append(TerrainEntry(date: date, value: min(1, max(0, value))))
                
                if i % 7 == 0 {
                    let memory = MemoryFlag(
                        date: date,
                        value: value,
                        note: ["Feeling grateful today", "Had a challenging day", "Great progress made", "Taking it one step at a time"].randomElement()!
                    )
                    memories[date] = [memory]
                }
            }
        }
    }
    
    func getEntries(for scale: TimeScale) -> [TerrainEntry] {
        let calendar = Calendar.current
        let now = Date()
        
        switch scale {
        case .week:
            return entries.filter { calendar.dateComponents([.day], from: $0.date, to: now).day! <= 7 }
        case .month:
            return entries.filter { calendar.dateComponents([.day], from: $0.date, to: now).day! <= 30 }
        case .year:
            return entries
        }
    }
    
    func addEntry(value: Double, note: String) {
        let entry = TerrainEntry(date: Date(), value: value)
        entries.insert(entry, at: 0)
        
        let memory = MemoryFlag(date: Date(), value: value, note: note)
        memories[Date()] = [memory]
    }
}

struct TerrainEntry {
    let date: Date
    let value: Double
}