struct ContentView: View {
    @State private var items: [ShelfItem] = []
    
    var body: some View {
        VStack(spacing: 0) {
            headerView
            
            ScrollView {
                LazyVStack(spacing: 24) {
                    ForEach(Array(sortedItems.enumerated()), id: \.element.id) { index, item in
                        ShelfItemView(item: item, isAlternate: index % 2 == 1)
                    }
                }
                .padding(24)
            }
            .background(decayGradientBackground)
        }
        .frame(minWidth: 500, minHeight: 400)
        .onAppear {
            generateSampleItems()
        }
    }
    
    private var decayGradientBackground: some View {
        let averageDecay = items.isEmpty ? 0 : items.map(\.decayProgress).reduce(0, +) / Double(items.count)
        
        return LinearGradient(
            colors: [
                Color.blue.opacity(0.03 * (1 - averageDecay)),
                Color.orange.opacity(0.05 * averageDecay),
                Color.red.opacity(0.08 * averageDecay)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .animation(.easeInOut(duration: 2.0), value: averageDecay)
    }
    
    private var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
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
                    .symbolEffect(.bounce, options: .nonRepeating, value: items.count)
            }
            .buttonStyle(.borderless)
            .foregroundStyle(.secondary)
            .hoverEffect(.highlight)
        }
        .padding(24)
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

struct ShelfItemView: View {
    let item: ShelfItem
    let isAlternate: Bool
    @State private var animationTrigger = false
    
    var body: some View {
        HStack(spacing: 16) {
            categoryIcon
            
            VStack(alignment: .leading, spacing: 8) {
                Text(item.name)
                    .font(.headline)
                    .fontWeight(.medium)
                    .lineLimit(2)
                    .foregroundStyle(textColor)
                
                HStack(spacing: 12) {
                    Text(timeAgoText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    
                    decayIndicator
                    
                    Spacer()
                }
            }
            
            Spacer()
        }
        .padding(isAlternate ? .leading : .trailing, 8)
        .padding(.vertical, 16)
        .padding(.horizontal, 20)
        .background(itemBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(color: shadowColor, radius: shadowRadius, x: 0, y: shadowOffset)
        .opacity(itemOpacity)
        .scaleEffect(itemScale)
        .animation(.easeInOut(duration: 3.0).repeatForever(autoreverses: true), value: animationTrigger)
        .onAppear {
            if case .fading = item.decayState {
                animationTrigger.toggle()
            }
            if case .ghost = item.decayState {
                animationTrigger.toggle()
            }
        }
    }
    
    private var categoryIcon: some View {
        Image(systemName: item.category.icon)
            .font(.title2)
            .foregroundStyle(iconColor)
            .frame(width: 32, height: 32)
            .background(iconBackgroundColor)
            .clipShape(Circle())
    }
    
    private var decayIndicator: some View {
        HStack(spacing: 4) {
            ForEach(0..<5) { index in
                Circle()
                    .fill(dotColor(for: index))
                    .frame(width: 4, height: 4)
            }
        }
    }
    
    private var itemBackground: some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(.regularMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(borderColor, lineWidth: borderWidth)
            )
    }
    
    private var timeAgoText: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: item.createdAt, relativeTo: Date())
    }
    
    private var textColor: Color {
        switch item.decayState {
        case .fresh: return .primary
        case .aging: return .primary.opacity(0.9)
        case .fading: return .secondary
        case .ghost: return .secondary.opacity(0.7)
        }
    }
    
    private var iconColor: Color {
        switch item.decayState {
        case .fresh: return .blue
        case .aging: return .orange
        case .fading: return .red.opacity(0.8)
        case .ghost: return .gray.opacity(0.6)
        }
    }
    
    private var iconBackgroundColor: Color {
        switch item.decayState {
        case .fresh: return .blue.opacity(0.1)
        case .aging: return .orange.opacity(0.1)
        case .fading: return .red.opacity(0.08)
        case .ghost: return .gray.opacity(0.05)
        }
    }
    
    private var borderColor: Color {
        switch item.decayState {
        case .fresh: return .blue.opacity(0.2)
        case .aging: return .orange.opacity(0.3)
        case .fading: return .red.opacity(0.2)
        case .ghost: return .gray.opacity(0.1)
        }
    }
    
    private var borderWidth: Double {
        switch item.decayState {
        case .fresh: return 1.0
        case .aging: return 0.8
        case .fading: return 0.5
        case .ghost: return 0.3
        }
    }
    
    private var shadowColor: Color {
        switch item.decayState {
        case .fresh: return .black.opacity(0.08)
        case .aging: return .black.opacity(0.06)
        case .fading: return .black.opacity(0.03)
        case .ghost: return .clear
        }
    }
    
    private var shadowRadius: Double {
        switch item.decayState {
        case .fresh: return 8
        case .aging: return 6
        case .fading: return 3
        case .ghost: return 0
        }
    }
    
    private var shadowOffset: Double {
        switch item.decayState {
        case .fresh: return 2
        case .aging: return 1
        case .fading: return 0.5
        case .ghost: return 0
        }
    }
    
    private var itemOpacity: Double {
        switch item.decayState {
        case .fresh: return 1.0
        case .aging: return 0.95
        case .fading: return animationTrigger ? 0.7 : 0.85
        case .ghost: return animationTrigger ? 0.4 : 0.6
        }
    }
    
    private var itemScale: Double {
        switch item.decayState {
        case .fresh: return 1.0
        case .aging: return 1.0
        case .fading: return animationTrigger ? 0.995 : 1.0
        case .ghost: return animationTrigger ? 0.99 : 1.0
        }
    }
    
    private func dotColor(for index: Int) -> Color {
        let filledDots = Int(item.decayProgress * 5)
        if index < filledDots {
            switch item.decayState {
            case .fresh: return .blue.opacity(0.8)
            case .aging: return .orange.opacity(0.8)
            case .fading: return .red.opacity(0.8)
            case .ghost: return .gray.opacity(0.6)
            }
        } else {
            return .gray.opacity(0.2)
        }
    }
}