struct ContentView: View {
    @State private var dailySleepEntries: [SleepEntry] = []
    @State private var selectedWeek = Date()
    @State private var showingEntrySheet = false
    @State private var entryDate = Date()
    @State private var entryHours: Double = 7.0
    
    let weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    let hourLabels = ["12 AM", "6 AM", "12 PM", "6 PM", "12 AM"]
    
    var weekDates: [Date] {
        guard let weekInterval = Calendar.current.dateInterval(of: .weekOfYear, for: selectedWeek) else { return [] }
        let startOfWeek = weekInterval.start
        return (0..<7).compactMap { dayOffset in
            Calendar.current.date(byAdding: .day, value: dayOffset, to: startOfWeek)
        }
    }
    
    var averageSleep: Double {
        let entries = dailySleepEntries.filter { entry in
            weekDates.contains { Calendar.current.isDate($0, inSameDayAs: entry.date) }
        }
        guard !entries.isEmpty else { return 0 }
        return entries.map(\.hours).reduce(0, +) / Double(entries.count)
    }
    
    var sleepDebt: Double {
        let totalNeeded = 8.0 * 7
        let totalActual = dailySleepEntries.filter { entry in
            weekDates.contains { Calendar.current.isDate($0, inSameDayAs: entry.date) }
        }.map(\.hours).reduce(0, +)
        return max(0, totalNeeded - totalActual)
    }
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Week selector
                    HStack {
                        Button(action: previousWeek) {
                            Image(systemName: "chevron.left")
                                .foregroundColor(.primary)
                        }
                        
                        Spacer()
                        
                        Text(weekRangeText)
                            .font(.headline)
                        
                        Spacer()
                        
                        Button(action: nextWeek) {
                            Image(systemName: "chevron.right")
                                .foregroundColor(.primary)
                        }
                    }
                    .padding(.horizontal)
                    
                    // Summary cards
                    HStack(spacing: 16) {
                        SummaryCard(
                            title: "Average Sleep",
                            value: String(format: "%.1f hrs", averageSleep),
                            icon: "moon.fill",
                            color: averageSleep >= 7 ? .green : .orange
                        )
                        
                        SummaryCard(
                            title: "Sleep Debt",
                            value: String(format: "%.1f hrs", sleepDebt),
                            icon: "exclamationmark.triangle.fill",
                            color: sleepDebt > 10 ? .red : .orange
                        )
                    }
                    .padding(.horizontal)
                    
                    // Weekly sleep chart
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Weekly Sleep Pattern")
                            .font(.headline)
                            .padding(.horizontal)
                        
                        ZStack(alignment: .topLeading) {
                            // Grid background
                            GeometryReader { geometry in
                                Path { path in
                                    // Horizontal lines
                                    for i in 0...4 {
                                        let y = CGFloat(i) * geometry.size.height / 4
                                        path.move(to: CGPoint(x: 40, y: y))
                                        path.addLine(to: CGPoint(x: geometry.size.width - 16, y: y))
                                    }
                                    
                                    // Vertical lines
                                    for i in 0...7 {
                                        let x = 40 + CGFloat(i) * (geometry.size.width - 56) / 7
                                        path.move(to: CGPoint(x: x, y: 0))
                                        path.addLine(to: CGPoint(x: x, y: geometry.size.height))
                                    }
                                }
                                .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
                                
                                // Hour labels
                                ForEach(0..<5) { i in
                                    Text("\(12 - i * 3)")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                        .position(x: 20, y: CGFloat(i) * geometry.size.height / 4)
                                }
                                
                                // Sleep bars
                                ForEach(Array(weekDates.enumerated()), id: \.offset) { index, date in
                                    if let entry = sleepEntry(for: date) {
                                        let barWidth = (geometry.size.width - 56) / 7
                                        let x = 40 + CGFloat(index) * barWidth + barWidth / 2
                                        let height = CGFloat(entry.hours / 12) * geometry.size.height
                                        let y = geometry.size.height - height / 2
                                        
                                        RoundedRectangle(cornerRadius: 4)
                                            .fill(colorForHours(entry.hours))
                                            .frame(width: barWidth - 8, height: height)
                                            .position(x: x, y: y)
                                            .onTapGesture {
                                                editEntry(for: date)
                                            }
                                    }
                                }
                                
                                // Target line
                                Path { path in
                                    let y = geometry.size.height * (1 - 8.0/12.0)
                                    path.move(to: CGPoint(x: 40, y: y))
                                    path.addLine(to: CGPoint(x: geometry.size.width - 16, y: y))
                                }
                                .stroke(Color.green, style: StrokeStyle(lineWidth: 2, dash: [5, 5]))
                            }
                        }
                        .frame(height: 240)
                        .padding(.horizontal)
                        
                        // Day labels
                        HStack {
                            ForEach(Array(weekDates.enumerated()), id: \.offset) { index, date in
                                VStack(spacing: 4) {
                                    Text(weekDays[index])
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                    
                                    Text("\(Calendar.current.component(.day, from: date))")
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                }
                                .frame(maxWidth: .infinity)
                            }
                        }
                        .padding(.horizontal, 40)
                    }
                    
                    // Add entry button
                    Button(action: { showingEntrySheet = true }) {
                        Label("Add Sleep Entry", systemImage: "plus.circle.fill")
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.blue)
                            .cornerRadius(10)
                    }
                    .padding(.horizontal)
                    
                    // Recent entries
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Recent Entries")
                            .font(.headline)
                        
                        ForEach(recentEntries) { entry in
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(entry.date, style: .date)
                                        .font(.subheadline)
                                    Text("\(entry.hours, specifier: "%.1f") hours")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                
                                Spacer()
                                
                                Circle()
                                    .fill(colorForHours(entry.hours))
                                    .frame(width: 12, height: 12)
                            }
                            .padding()
                            .background(Color.secondary.opacity(0.1))
                            .cornerRadius(8)
                            .onTapGesture {
                                editEntry(for: entry.date)
                            }
                        }
                    }
                    .padding(.horizontal)
                }
                .padding(.vertical)
            }
            .navigationTitle("Sleep Tracker")
            .sheet(isPresented: $showingEntrySheet) {
                NavigationView {
                    Form {
                        DatePicker("Date", selection: $entryDate, displayedComponents: .date)
                        
                        VStack(alignment: .leading) {
                            Text("Hours Slept: \(entryHours, specifier: "%.1f")")
                            Slider(value: $entryHours, in: 0...12, step: 0.5)
                        }
                    }
                    .navigationTitle("Sleep Entry")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") {
                                showingEntrySheet = false
                            }
                        }
                        
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Save") {
                                saveEntry()
                            }
                        }
                    }
                }
            }
        }
    }
    
    var weekRangeText: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d"
        
        guard let endOfWeek = weekDates.last else { return "" }
        return "\(formatter.string(from: weekDates[0])) - \(formatter.string(from: endOfWeek))"
    }
    
    var recentEntries: [SleepEntry] {
        dailySleepEntries
            .sorted { $0.date > $1.date }
            .prefix(5)
            .map { $0 }
    }
    
    func sleepEntry(for date: Date) -> SleepEntry? {
        dailySleepEntries.first { Calendar.current.isDate($0.date, inSameDayAs: date) }
    }
    
    func colorForHours(_ hours: Double) -> Color {
        if hours >= 8 { return .green }
        if hours >= 6 { return .orange }
        return .red
    }
    
    func previousWeek() {
        withAnimation {
            selectedWeek = Calendar.current.date(byAdding: .weekOfYear, value: -1, to: selectedWeek) ?? selectedWeek
        }
    }
    
    func nextWeek() {
        withAnimation {
            selectedWeek = Calendar.current.date(byAdding: .weekOfYear, value: 1, to: selectedWeek) ?? selectedWeek
        }
    }
    
    func editEntry(for date: Date) {
        entryDate = date
        entryHours = sleepEntry(for: date)?.hours ?? 7.0
        showingEntrySheet = true
    }
    
    func saveEntry() {
        if let index = dailySleepEntries.firstIndex(where: { Calendar.current.isDate($0.date, inSameDayAs: entryDate) }) {
            dailySleepEntries[index].hours = entryHours
        } else {
            dailySleepEntries.append(SleepEntry(date: entryDate, hours: entryHours))
        }
        showingEntrySheet = false
    }
}

struct SleepEntry: Identifiable {
    let id = UUID()
    let date: Date
    var hours: Double
}

struct SummaryCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .foregroundColor(color)
                Spacer()
            }
            
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
            
            Text(value)
                .font(.title2)
                .fontWeight(.semibold)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.1))
        .cornerRadius(12)
    }
}