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
        GeometryReader { geometry in
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(Array(sortedItems.enumerated()), id: \.element.id) { index, item in
                        shelfItemView(item: item, index: index)
                            .zIndex(Double(sortedItems.count - index))
                            .animation(.spring(response: 0.6, dampingFraction: 0.8), value: selectedItem)
                            .animation(.spring(response: 0.6, dampingFraction: 0.8), value: hoveredItem)
                    }
                }
                .padding(.top, 20)
                .padding(.bottom, 40)
            }
        }
        .background(
            LinearGradient(
                colors: [Color.black.opacity(0.02), Color.black.opacity(0.08)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
    
    private func shelfItemView(item: ShelfItem, index: Int) -> some View {
        let isSelected = selectedItem == item.id
        let isHovered = hoveredItem == item.id
        let depthOffset = CGFloat(index) * 2
        let sideOffset = sin(Double(index) * 0.3) * 8
        
        HStack(spacing: 12) {
            thumbnailView(for: item)
            contentView(for: item)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, item.isRecent ? 16 : 12)
        .background(
            RoundedRectangle(cornerRadius: item.isRecent ? 12 : 8)
                .fill(.ultraThinMaterial)
                .shadow(
                    color: item.isRecent ? .accentColor.opacity(0.3) : .black.opacity(0.1),
                    radius: item.isRecent ? 8 : 4,
                    x: 0,
                    y: 2 + depthOffset
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: item.isRecent ? 12 : 8)
                .stroke(
                    item.isRecent ? .accentColor.opacity(0.4) : Color.clear,
                    lineWidth: item.isRecent ? 1 : 0
                )
        )
        .scaleEffect(
            isSelected ? 1.02 : (isHovered ? 1.01 : (item.isRecent ? 1.0 : 0.98))
        )
        .offset(
            x: sideOffset + (isSelected ? 4 : 0),
            y: isSelected ? -4 : 0
        )
        .opacity(1.0 - item.decayLevel * 0.4)
        .blur(radius: item.decayLevel * 2)
        .saturation(1.0 - item.decayLevel * 0.6)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
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
            RoundedRectangle(cornerRadius: item.isRecent ? 10 : 8)
                .fill(item.isRecent ? .quaternary : .quinary)
                .frame(width: item.isRecent ? 40 : 32, height: item.isRecent ? 40 : 32)
                .overlay(
                    RoundedRectangle(cornerRadius: item.isRecent ? 10 : 8)
                        .stroke(.tertiary, lineWidth: 0.5)
                )
            
            switch item.type {
            case .text:
                Image(systemName: "doc.text.fill")
                    .font(.system(size: item.isRecent ? 18 : 14, weight: .medium))
                    .foregroundStyle(item.isRecent ? .blue : .secondary)
                    
            case .image:
                Image(systemName: "photo.fill")
                    .font(.system(size: item.isRecent ? 18 : 14, weight: .medium))
                    .foregroundStyle(item.isRecent ? .green : .secondary)
                
            case .url:
                Image(systemName: "link.circle.fill")
                    .font(.system(size: item.isRecent ? 18 : 14, weight: .medium))
                    .foregroundStyle(item.isRecent ? .purple : .secondary)
            }
        }
        .shadow(color: .black.opacity(0.1), radius: 2, x: 0, y: 1)
    }
    
    private func contentView(for item: ShelfItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(item.content)
                .font(item.isRecent ? .body.weight(.medium) : .body)
                .foregroundStyle(.primary)
                .lineLimit(item.isRecent ? 3 : 2)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            
            HStack(spacing: 8) {
                Text(timeAgoString(from: item.createdAt))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                
                if item.isDecaying {
                    Image(systemName: "clock.fill")
                        .font(.system(size: 8))
                        .foregroundStyle(.orange.opacity(0.8))
                }
            }
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