struct ShelfItem: Identifiable {
    let id = UUID()
    let content: String
    let type: ItemType
    let createdAt: Date
    var isDecayed: Bool = false
    
    enum ItemType {
        case text
        case url
        case image
        case file
    }
}

class ShelfStore: ObservableObject {
    @Published var items: [ShelfItem] = []
    
    func addItem(_ item: ShelfItem) {
        if items.count < 8 {
            items.append(item)
        }
    }
    
    func removeItem(_ item: ShelfItem) {
        items.removeAll { $0.id == item.id }
    }
}

struct ContentView: View {
    @StateObject private var store: ShelfStore = ShelfStore()
    @State private var dragOver: Bool = false
    
    var body: some View {
        ZStack {
            Color(red: 0.172, green: 0.094, blue: 0.063)
            
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    ForEach(0..<8) { index in
                        SlotView(
                            item: index < store.items.count ? store.items[index] : nil,
                            onRemove: { item in
                                store.removeItem(item)
                            }
                        )
                    }
                }
                .padding(16)
            }
        }
        .frame(width: 680, height: 120)
        .onDrop(of: ["public.text", "public.url", "public.file-url"], isTargeted: $dragOver) { providers -> Bool in
            handleDrop(providers)
        }
        .overlay(
            dragOver ? Color.white.opacity(0.1) : Color.clear
        )
    }
    
    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        guard let provider = providers.first else { return false }
        
        if provider.hasItemConformingToTypeIdentifier("public.url") {
            provider.loadItem(forTypeIdentifier: "public.url", options: nil) { data, _ in
                if let url = data as? URL {
                    DispatchQueue.main.async {
                        let item = ShelfItem(
                            content: url.absoluteString,
                            type: url.pathExtension.lowercased() == "png" || url.pathExtension.lowercased() == "jpg" || url.pathExtension.lowercased() == "jpeg" ? .image : .url,
                            createdAt: Date()
                        )
                        store.addItem(item)
                    }
                }
            }
            return true
        }
        
        if provider.hasItemConformingToTypeIdentifier("public.text") {
            provider.loadItem(forTypeIdentifier: "public.text", options: nil) { data, _ in
                if let text = data as? String {
                    DispatchQueue.main.async {
                        let item = ShelfItem(
                            content: text,
                            type: .text,
                            createdAt: Date()
                        )
                        store.addItem(item)
                    }
                }
            }
            return true
        }
        
        return false
    }
}

struct SlotView: View {
    let item: ShelfItem?
    let onRemove: (ShelfItem) -> Void
    @State private var isDragging: Bool = false
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(red: 0.95, green: 0.93, blue: 0.88))
                .shadow(color: Color.black.opacity(0.2), radius: 2, x: 0, y: 1)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color(red: 0.85, green: 0.8, blue: 0.72), lineWidth: 1)
                )
            
            if let item = item {
                ItemPreview(item: item)
                    .opacity(item.isDecayed ? 0.4 : 1.0)
                    .scaleEffect(isDragging ? 0.95 : 1.0)
                    .animation(.easeInOut(duration: 0.1), value: isDragging)
                    .draggable(item.content) {
                        ItemPreview(item: item)
                            .opacity(0.8)
                    }
                    .onDrag {
                        isDragging = true
                        return NSItemProvider(object: item.content as NSString)
                    }
                    .simultaneousGesture(
                        DragGesture()
                            .onEnded { value in
                                isDragging = false
                                if value.translation.height < -20 || abs(value.translation.width) > 40 {
                                    onRemove(item)
                                }
                            }
                    )
            }
        }
        .frame(width: 72, height: 72)
    }
}

struct ItemPreview: View {
    let item: ShelfItem
    
    var body: some View {
        switch item.type {
        case .text:
            VStack(spacing: 2) {
                Image(systemName: "doc.text")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(Color(red: 0.4, green: 0.3, blue: 0.2))
                Text(String(item.content.prefix(20)))
                    .font(.system(size: 8, weight: .regular))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
            }
            .padding(4)
            
        case .url:
            VStack(spacing: 2) {
                Image(systemName: "link")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(Color.blue)
                if let host = URL(string: item.content)?.host {
                    Text(host)
                        .font(.system(size: 8, weight: .regular))
                        .lineLimit(1)
                        .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
                }
            }
            .padding(4)
            
        case .image:
            VStack(spacing: 2) {
                Image(systemName: "photo")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(Color.green)
                Text("Image")
                    .font(.system(size: 8, weight: .regular))
                    .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
            }
            .padding(4)
            
        case .file:
            VStack(spacing: 2) {
                Image(systemName: "doc")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(Color.orange)
                Text("File")
                    .font(.system(size: 8, weight: .regular))
                    .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
            }
            .padding(4)
        }
    }
}