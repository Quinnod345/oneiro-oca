struct ContentView: View {
    @StateObject private var storage: ShelfStorage = ShelfStorage()
    @State private var dragOverIndex: Int? = nil
    @State private var isDragging: Bool = false
    
    var body: some View {
        ZStack {
            Color(red: 0.95, green: 0.92, blue: 0.87)
            
            VStack(spacing: 0) {
                HStack(spacing: 2) {
                    ForEach(0..<8, id: \.self) { index in
                        SlotView(
                            item: storage.items[index],
                            isHighlighted: dragOverIndex == index,
                            isPulsing: isDragging && storage.items[index] == nil
                        )
                        .onDrop(of: ["public.file-url", "public.plain-text", "public.url"], isTargeted: Binding(
                            get: { dragOverIndex == index },
                            set: { isTargeted in
                                if isTargeted {
                                    dragOverIndex = index
                                } else if dragOverIndex == index {
                                    dragOverIndex = nil
                                }
                            }
                        )) { providers in
                            handleDrop(providers: providers, at: index)
                        }
                        .contextMenu {
                            if storage.items[index] != nil {
                                Button("Remove") {
                                    withAnimation(.spring(dampingFraction: 0.65)) {
                                        storage.removeItem(at: index)
                                    }
                                }
                            }
                        }
                        
                        if index < 7 {
                            Rectangle()
                                .fill(Color(red: 0.7, green: 0.6, blue: 0.5))
                                .frame(width: 1, height: 50)
                                .opacity(0.4)
                        }
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                
                Rectangle()
                    .fill(LinearGradient(
                        colors: [
                            Color(red: 0.6, green: 0.5, blue: 0.4),
                            Color(red: 0.8, green: 0.7, blue: 0.6)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    ))
                    .frame(height: 8)
            }
        }
        .frame(width: 400, height: 64)
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didChangeOcclusionStateNotification)) { _ in
            isDragging = false
            dragOverIndex = nil
        }
    }
    
    private func handleDrop(providers: [NSItemProvider], at index: Int) -> Bool {
        isDragging = false
        dragOverIndex = nil
        
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier("public.file-url") {
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    guard let url = url else { return }
                    DispatchQueue.main.async {
                        let item = DragItem(
                            type: .file,
                            title: url.lastPathComponent,
                            subtitle: url.path,
                            data: try? Data(contentsOf: url),
                            dateAdded: Date()
                        )
                        withAnimation(.spring(dampingFraction: 0.65)) {
                            storage.addItem(item, at: index)
                        }
                    }
                }
                return true
            } else if provider.hasItemConformingToTypeIdentifier("public.url") {
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    guard let url = url else { return }
                    DispatchQueue.main.async {
                        let item = DragItem(
                            type: .url,
                            title: url.host ?? url.absoluteString,
                            subtitle: url.absoluteString,
                            data: nil,
                            dateAdded: Date()
                        )
                        withAnimation(.spring(dampingFraction: 0.65)) {
                            storage.addItem(item, at: index)
                        }
                    }
                }
                return true
            } else if provider.hasItemConformingToTypeIdentifier("public.plain-text") {
                _ = provider.loadObject(ofClass: String.self) { string, _ in
                    guard let string = string else { return }
                    DispatchQueue.main.async {
                        let preview = String(string.prefix(50)) + (string.count > 50 ? "..." : "")
                        let item = DragItem(
                            type: .text,
                            title: preview,
                            subtitle: "\(string.count) characters",
                            data: string.data(using: .utf8),
                            dateAdded: Date()
                        )
                        withAnimation(.spring(dampingFraction: 0.65)) {
                            storage.addItem(item, at: index)
                        }
                    }
                }
                return true
            }
        }
        return false
    }
}

struct SlotView: View {
    let item: DragItem?
    let isHighlighted: Bool
    let isPulsing: Bool
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(red: 0.9, green: 0.87, blue: 0.82))
                .stroke(
                    isHighlighted ? 
                    Color(red: 1.0, green: 0.75, blue: 0.3) :
                    Color(red: 0.8, green: 0.7, blue: 0.6),
                    lineWidth: isHighlighted ? 2 : 1
                )
                .shadow(
                    color: isHighlighted ? 
                    Color(red: 1.0, green: 0.75, blue: 0.3).opacity(0.5) :
                    Color.black.opacity(0.1),
                    radius: isHighlighted ? 4 : 1,
                    x: 0,
                    y: isHighlighted ? 0 : 1
                )
                .scaleEffect(isPulsing ? 1.05 : 1.0)
                .animation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true), value: isPulsing)
            
            if let item = item {
                VStack(spacing: 2) {
                    Image(systemName: iconName(for: item.type))
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(iconColor(for: item.type))
                    
                    Text(item.title)
                        .font(.system(size: 9, weight: .medium))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .foregroundColor(Color(red: 0.4, green: 0.3, blue: 0.2))
                }
                .padding(4)
                .opacity(item.opacity)
            } else {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .light))
                    .foregroundColor(Color(red: 0.7, green: 0.6, blue: 0.5))
                    .opacity(0.5)
            }
        }
        .frame(width: 44, height: 50)
        .scaleEffect(isHighlighted ? 1.05 : 1.0)
        .animation(.spring(dampingFraction: 0.65), value: isHighlighted)
    }
    
    private func iconName(for type: DragItem.ItemType) -> String {
        switch type {
        case .file: return "doc.fill"
        case .text: return "text.alignleft"
        case .url: return "globe"
        }
    }
    
    private func iconColor(for type: DragItem.ItemType) -> Color {
        switch type {
        case .file: return Color.blue
        case .text: return Color.green
        case .url: return Color.orange
        }
    }
}