struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(type: .text, content: "Remember to check the quarterly reports before the meeting tomorrow", createdAt: Date().addingTimeInterval(-2 * 24 * 3600)),
        ShelfItem(type: .image, content: "wireframe_sketch.png", createdAt: Date().addingTimeInterval(-1 * 24 * 3600)),
        ShelfItem(type: .url, content: "https://developer.apple.com/documentation/swiftui", createdAt: Date().addingTimeInterval(-3 * 24 * 3600)),
        ShelfItem(type: .text, content: "Buy coffee beans", createdAt: Date().addingTimeInterval(-8 * 24 * 3600)),
        ShelfItem(type: .url, content: "https://github.com/username/project", createdAt: Date())
    ]
    
    @State private var draggedItem: ShelfItem?
    @State private var dragOffset: CGSize = .zero
    
    var body: some View {
        VStack(spacing: 0) {
            headerView
            shelfView
        }
        .frame(width: 420, height: 480)
        .background(warmMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
    
    private var headerView: some View {
        HStack {
            Text("Shelf")
                .font(.system(size: 18, weight: .medium, design: .serif))
                .foregroundColor(Color(red: 0.35, green: 0.25, blue: 0.15))
            
            Spacer()
            
            Text("\(items.count)/8")
                .font(.system(size: 12, weight: .regular, design: .monospaced))
                .foregroundColor(Color(red: 0.6, green: 0.5, blue: 0.4))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color(red: 0.96, green: 0.94, blue: 0.88))
    }
    
    private var shelfView: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(items) { item in
                    itemCard(for: item)
                        .opacity(item.isDecaying ? 0.4 : 1.0)
                        .scaleEffect(draggedItem?.id == item.id ? 1.02 : 1.0)
                        .shadow(
                            color: draggedItem?.id == item.id ? 
                                Color(red: 0.2, green: 0.1, blue: 0.05).opacity(0.3) : 
                                Color.clear,
                            radius: draggedItem?.id == item.id ? 8 : 0,
                            x: 0, y: 4
                        )
                        .offset(draggedItem?.id == item.id ? dragOffset : .zero)
                        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: draggedItem?.id == item.id)
                        .gesture(
                            DragGesture()
                                .onChanged { value in
                                    if draggedItem == nil {
                                        draggedItem = item
                                    }
                                    if draggedItem?.id == item.id {
                                        dragOffset = value.translation
                                    }
                                }
                                .onEnded { _ in
                                    draggedItem = nil
                                    dragOffset = .zero
                                }
                        )
                }
            }
            .padding(16)
        }
    }
    
    private func itemCard(for item: ShelfItem) -> some View {
        HStack(spacing: 12) {
            thumbnailView(for: item)
            contentView(for: item)
            Spacer()
        }
        .padding(12)
        .background(cardMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
    
    private func thumbnailView(for item: ShelfItem) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(red: 0.92, green: 0.88, blue: 0.82))
                .frame(width: 48, height: 48)
            
            switch item.type {
            case .text:
                Image(systemName: "doc.text")
                    .font(.system(size: 20, weight: .light))
                    .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
                    
            case .image:
                ZStack {
                    Color(red: 0.85, green: 0.82, blue: 0.75)
                    Image(systemName: "photo")
                        .font(.system(size: 18, weight: .light))
                        .foregroundColor(Color(red: 0.6, green: 0.5, blue: 0.4))
                }
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .frame(width: 44, height: 44)
                
            case .url:
                ZStack {
                    Circle()
                        .fill(Color(red: 0.88, green: 0.85, blue: 0.78))
                        .frame(width: 24, height: 24)
                    Text(domainInitial(from: item.content))
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundColor(Color(red: 0.45, green: 0.35, blue: 0.25))
                }
            }
        }
    }
    
    private func contentView(for item: ShelfItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            switch item.type {
            case .text:
                HStack(spacing: 0) {
                    Rectangle()
                        .fill(Color(red: 0.8, green: 0.7, blue: 0.6))
                        .frame(width: 2)
                        .padding(.trailing, 8)
                    
                    Text(item.content)
                        .font(.system(size: 13, weight: .regular, design: .default))
                        .foregroundColor(Color(red: 0.25, green: 0.2, blue: 0.15))
                        .lineLimit(2)
                        .truncationMode(.tail)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                
            case .image:
                Text(item.content)
                    .font(.system(size: 13, weight: .medium, design: .default))
                    .foregroundColor(Color(red: 0.3, green: 0.25, blue: 0.2))
                    .lineLimit(1)
                    .truncationMode(.middle)
                
            case .url:
                VStack(alignment: .leading, spacing: 2) {
                    Text(extractDomain(from: item.content))
                        .font(.system(size: 13, weight: .medium, design: .default))
                        .foregroundColor(Color(red: 0.3, green: 0.25, blue: 0.2))
                        .lineLimit(1)
                    
                    Text(item.content)
                        .font(.system(size: 11, weight: .regular, design: .monospaced))
                        .foregroundColor(Color(red: 0.55, green: 0.45, blue: 0.35))
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            
            if item.isDecaying {
                Text("\(daysSinceCreation(item.createdAt))d ago")
                    .font(.system(size: 10, weight: .regular, design: .default))
                    .foregroundColor(Color(red: 0.65, green: 0.55, blue: 0.45))
            }
        }
    }
    
    private var warmMaterial: some View {
        Color(red: 0.94, green: 0.91, blue: 0.85)
    }
    
    private var cardMaterial: some View {
        Color(red: 0.98, green: 0.96, blue: 0.92)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color(red: 0.9, green: 0.85, blue: 0.78), lineWidth: 0.5)
            )
    }
    
    private func extractDomain(from urlString: String) -> String {
        let cleanUrl = urlString.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "")
        return String(cleanUrl.split(separator: "/").first ?? "")
    }
    
    private func domainInitial(from urlString: String) -> String {
        let domain = extractDomain(from: urlString)
        return String(domain.prefix(1)).uppercased()
    }
    
    private func daysSinceCreation(_ date: Date) -> Int {
        Int(Date().timeIntervalSince(date) / (24 * 3600))
    }
}