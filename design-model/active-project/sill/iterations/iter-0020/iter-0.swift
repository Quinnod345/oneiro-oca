struct ContentView: View {
    @State private var items: [ShelfItem] = []
    
    var body: some View {
        VStack(spacing: 0) {
            headerView
            
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(sortedItems) { item in
                        ShelfItemView(item: item)
                    }
                }
                .padding(16)
            }
            .background(Color(red: 0.98, green: 0.96, blue: 0.93))
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            generateSampleItems()
        }
    }
    
    private var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Shelf")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(Color(red: 0.2, green: 0.15, blue: 0.1))
                
                Text("\(items.count) items • \(fadingItemsCount) aging")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
            }
            
            Spacer()
            
            Button(action: generateSampleItems) {
                Image(systemName: "plus")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Color(red: 0.4, green: 0.3, blue: 0.2))
            }
            .buttonStyle(PlainButtonStyle())
        }
        .padding(20)
        .background(Color(red: 0.96, green: 0.93, blue: 0.88))
    }
    
    private var sortedItems: [ShelfItem] {
        items.sorted { $0.createdAt > $1.createdAt }
    }
    
    private var fadingItemsCount: Int {
        items.filter { item in
            if case .fading = item.decayState { return true }
            if case .ghost = item.decayState { return true }
            return false
        }.count
    }
    
    private func generateSampleItems() {
        let sampleNames = [
            "Meeting notes from design review",
            "Article about SwiftUI animations",
            "Grocery list for weekend",
            "Random thought about time",
            "Link to interesting podcast",
            "Draft email to client",
            "Photo from last vacation",
            "Code snippet for later",
            "Book recommendation",
            "Recipe to try"
        ]
        
        let categories = ItemCategory.allCases
        let now = Date()
        
        items = (0..<12).map { index in
            let daysAgo = Double.random(in: 0...8)
            let createdAt = now.addingTimeInterval(-daysAgo * 24 * 3600)
            
            return ShelfItem(
                name: sampleNames.randomElement() ?? "Untitled",
                createdAt: createdAt,
                category: categories.randomElement() ?? .note
            )
        }
    }
}