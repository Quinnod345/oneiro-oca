struct ContentView: View {
    @State private var items: [ShelfItem] = []
    
    var body: some View {
        VStack(spacing: 0) {
            headerView
            
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(sortedItems) { item in
                        ShelfItemView(item: item)
                    }
                }
                .padding(20)
            }
            .background(.windowBackground)
        }
        .frame(minWidth: 400, minHeight: 300)
        .onAppear {
            generateSampleItems()
        }
    }
    
    private var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Shelf")
                    .font(.largeTitle)
                    .fontWeight(.bold)
                    .foregroundStyle(.primary)
                
                Text("\(items.count) items • \(fadingItemsCount) aging")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            
            Spacer()
            
            Button(action: generateSampleItems) {
                Image(systemName: "plus")
                    .font(.title2)
                    .fontWeight(.medium)
            }
            .buttonStyle(.borderless)
            .foregroundStyle(.secondary)
        }
        .padding(20)
        .background(.thickMaterial)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(.separator)
                .frame(height: 0.5)
        }
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