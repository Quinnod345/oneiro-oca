struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(type: .text, content: "Remember to check the quarterly reports before the meeting tomorrow", createdAt: Date().addingTimeInterval(-2 * 24 * 3600)),
        ShelfItem(type: .image, content: "wireframe_sketch.png", createdAt: Date().addingTimeInterval(-1 * 24 * 3600)),
        ShelfItem(type: .url, content: "https://developer.apple.com/documentation/swiftui", createdAt: Date().addingTimeInterval(-3 * 24 * 3600)),
        ShelfItem(type: .text, content: "Buy coffee beans", createdAt: Date().addingTimeInterval(-8 * 24 * 3600)),
        ShelfItem(type: .url, content: "https://github.com/username/project", createdAt: Date())
    ]
    
    @State private var selectedItem: ShelfItem.ID?
    @State private var hoveredItem: ShelfItem.ID?
    
    var sortedItems: [ShelfItem] {
        items.sorted { $0.createdAt > $1.createdAt }
    }
    
    var body: some View {
        VStack(spacing: 0) {
            headerView
            shelfView
        }
        .frame(width: 420, height: 480)
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 12))
    }
    
    private var headerView: some View {
        HStack {
            Text("Shelf")
                .font(.headline)
                .foregroundStyle(.primary)
            
            Spacer()
            
            Text("\(items.count)/8")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color(.systemGray6))
    }
    
    private var shelfView: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(sortedItems) { item in
                    shelfItemView(item: item)
                }
            }
            .padding(16)
        }
        .background(Color(.systemGray6))
    }
    
    private func shelfItemView(item: ShelfItem) -> some View {
        let isSelected = selectedItem == item.id
        let isHovered = hoveredItem == item.id
        
        HStack(spacing: 12) {
            thumbnailView(for: item)
            contentView(for: item)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(.systemBackground))
                .shadow(color: .black.opacity(0.08), radius: 2, x: 0, y: 1)
        )
        .scaleEffect(isSelected ? 1.02 : (isHovered ? 1.01 : 1.0))
        .onTapGesture {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                selectedItem = selectedItem == item.id ? nil : item.id
            }
        }
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.2)) {
                hoveredItem = hovering ? item.id : nil
            }
        }
    }
    
    private func thumbnailView(for item: ShelfItem) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(.systemGray5))
                .frame(width: 36, height: 36)
            
            switch item.type {
            case .text:
                Image(systemName: "doc.text.fill")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.secondary)
                    
            case .image:
                Image(systemName: "photo.fill")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.secondary)
                
            case .url:
                Image(systemName: "link.circle.fill")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.secondary)
            }
        }
    }
    
    private func contentView(for item: ShelfItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(item.content)
                .font(.body)
                .foregroundStyle(.primary)
                .lineLimit(2)
            
            Text(timeAgoString(from: item.createdAt))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
    
    private func timeAgoString(from date: Date) -> String {
        let interval = Date().timeIntervalSince(date)
        let days = Int(interval / (24 * 3600))
        
        if days == 0 {
            return "Today"
        } else if days == 1 {
            return "Yesterday"
        } else {
            return "\(days) days ago"
        }
    }
}