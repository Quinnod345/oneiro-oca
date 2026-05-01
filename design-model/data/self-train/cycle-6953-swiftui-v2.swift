struct ContentView: View {
    @State private var selectedCategory = "All"
    @State private var memories: [Memory] = Memory.sampleData
    @State private var showingAddMemory = false
    @State private var searchText = ""
    
    let categories = ["All", "Places", "People", "Events", "Ideas"]
    
    var filteredMemories: [Memory] {
        memories.filter { memory in
            (selectedCategory == "All" || memory.category == selectedCategory) &&
            (searchText.isEmpty || memory.title.localizedCaseInsensitiveContains(searchText))
        }
    }
    
    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Search Bar
                HStack {
                    Image(systemName: "magnifyingglass")
                        .foregroundColor(.secondary)
                    TextField("Search memories", text: $searchText)
                        .textFieldStyle(PlainTextFieldStyle())
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(12)
                .padding()
                
                // Category Filter
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(categories, id: \.self) { category in
                            CategoryButton(
                                title: category,
                                isSelected: selectedCategory == category,
                                action: { selectedCategory = category }
                            )
                        }
                    }
                    .padding(.horizontal)
                }
                
                // Memory Grid
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 160))], spacing: 16) {
                        ForEach(filteredMemories) { memory in
                            MemoryCard(memory: memory)
                        }
                    }
                    .padding()
                }
                
                Spacer()
            }
            .navigationTitle("Memory Journal")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showingAddMemory = true }) {
                        Image(systemName: "plus.circle.fill")
                            .font(.title2)
                            .foregroundColor(.accentColor)
                    }
                }
            }
        }
        .sheet(isPresented: $showingAddMemory) {
            AddMemoryView(memories: $memories)
        }
    }
}

struct CategoryButton: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline)
                .fontWeight(isSelected ? .semibold : .regular)
                .foregroundColor(isSelected ? .white : .primary)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 20)
                        .fill(isSelected ? Color.accentColor : Color(.systemGray5))
                )
        }
    }
}

struct MemoryCard: View {
    let memory: Memory
    @State private var isExpanded = false
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header
            HStack {
                Image(systemName: memory.icon)
                    .font(.title3)
                    .foregroundColor(.white)
                    .frame(width: 32, height: 32)
                    .background(memory.color)
                    .cornerRadius(8)
                
                Spacer()
                
                Text(memory.date, style: .date)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            // Content
            Text(memory.title)
                .font(.headline)
                .foregroundColor(.primary)
                .lineLimit(2)
            
            Text(memory.description)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .lineLimit(isExpanded ? nil : 3)
            
            // Footer
            HStack {
                Label(memory.category, systemImage: "tag")
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                Spacer()
                
                Button(action: { withAnimation { isExpanded.toggle() } }) {
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .padding(.top, 4)
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: Color.black.opacity(0.05), radius: 8, x: 0, y: 2)
    }
}

struct AddMemoryView: View {
    @Binding var memories: [Memory]
    @Environment(\.dismiss) var dismiss
    
    @State private var title = ""
    @State private var description = ""
    @State private var selectedCategory = "Events"
    @State private var selectedDate = Date()
    
    let categories = ["Places", "People", "Events", "Ideas"]
    
    var body: some View {
        NavigationView {
            Form {
                Section("Details") {
                    TextField("Title", text: $title)
                    
                    TextEditor(text: $description)
                        .frame(minHeight: 100)
                }
                
                Section("Category") {
                    Picker("Category", selection: $selectedCategory) {
                        ForEach(categories, id: \.self) { category in
                            Text(category).tag(category)
                        }
                    }
                    .pickerStyle(SegmentedPickerStyle())
                }
                
                Section("Date") {
                    DatePicker("When", selection: $selectedDate, displayedComponents: .date)
                }
            }
            .navigationTitle("New Memory")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        let newMemory = Memory(
                            title: title,
                            description: description,
                            category: selectedCategory,
                            date: selectedDate
                        )
                        memories.append(newMemory)
                        dismiss()
                    }
                    .disabled(title.isEmpty || description.isEmpty)
                }
            }
        }
    }
}

struct Memory: Identifiable {
    let id = UUID()
    let title: String
    let description: String
    let category: String
    let date: Date
    
    var icon: String {
        switch category {
        case "Places": return "map"
        case "People": return "person.2"
        case "Events": return "calendar"
        case "Ideas": return "lightbulb"
        default: return "star"
        }
    }
    
    var color: Color {
        switch category {
        case "Places": return .blue
        case "People": return .green
        case "Events": return .orange
        case "Ideas": return .purple
        default: return .gray
        }
    }
    
    static let sampleData = [
        Memory(title: "First Day at New Job", description: "Started my position at the tech company. Met the team and got my workstation set up. Everyone was welcoming and I'm excited about the projects ahead.", category: "Events", date: Date().addingTimeInterval(-86400 * 7)),
        Memory(title: "Weekend Trip to the Mountains", description: "Drove up to the national park with friends. The weather was perfect and we hiked to the summit just in time for sunset. The view was absolutely breathtaking.", category: "Places", date: Date().addingTimeInterval(-86400 * 14)),
        Memory(title: "Coffee with Sarah", description: "Caught up with Sarah after months. We talked about her new startup idea and reminisced about college days. She's doing amazing things.", category: "People", date: Date().addingTimeInterval(-86400 * 3)),
        Memory(title: "App Idea: Habit Tracker", description: "Thought of a minimalist habit tracking app that uses psychology principles to build sustainable habits. Focus on simplicity and beautiful visualizations.", category: "Ideas", date: Date().addingTimeInterval(-86400 * 1))
    ]
}