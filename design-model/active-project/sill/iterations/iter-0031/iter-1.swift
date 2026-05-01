struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(type: .text, content: "Remember to check the quarterly reports before the meeting tomorrow", createdAt: Date().addingTimeInterval(-2 * 24 * 3600)),
        ShelfItem(type: .image, content: "wireframe_sketch.png", createdAt: Date().addingTimeInterval(-1 * 24 * 3600)),
        ShelfItem(type: .url, content: "https://developer.apple.com/documentation/swiftui", createdAt: Date().addingTimeInterval(-3 * 24 * 3600)),
        ShelfItem(type: .text, content: "Buy coffee beans", createdAt: Date().addingTimeInterval(-8 * 24 * 3600)),
        ShelfItem(type: .url, content: "https://github.com/username/project", createdAt: Date())
    ]
    
    @State private var selectedItem: ShelfItem.ID?
    
    var body: some View {
        VStack(spacing: 0) {
            headerView
            shelfView
        }
        .frame(width: 420, height: 480)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
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
        .background(.regularMaterial)
    }
    
    private var shelfView: some View {
        ScrollView {
            LazyVStack(spacing: 1) {
                ForEach(items) { item in
                    itemRow(for: item)
                        .listRowBackground(Color.clear)
                        .background(selectedItem == item.id ? Color.accentColor.opacity(0.2) : Color.clear)
                        .onTapGesture {
                            selectedItem = selectedItem == item.id ? nil : item.id
                        }
                }
            }
            .padding(.vertical, 8)
        }
        .background(.thinMaterial)
    }
    
    private func itemRow(for item: ShelfItem) -> some View {
        HStack(spacing: 12) {
            thumbnailView(for: item)
            contentView(for: item)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .opacity(item.isDecaying ? 0.6 : 1.0)
    }
    
    private func thumbnailView(for item: ShelfItem) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(.quaternary)
                .frame(width: 32, height: 32)
            
            switch item.type {
            case .text:
                Image(systemName: "doc.text")
                    .font(.system(size: 16))
                    .foregroundStyle(.secondary)
                    
            case .image:
                Image(systemName: "photo")
                    .font(.system(size: 16))
                    .foregroundStyle(.secondary)
                
            case .url:
                Image(systemName: "link")
                    .font(.system(size: 16))
                    .foregroundStyle(.secondary)
            }
        }
    }
    
    private func contentView(for item: ShelfItem) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(item.content)
                .font(.body)
                .foregroundStyle(.primary)
                .lineLimit(2)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            
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