enum ItemType {
    case file
    case url
    case text
}

struct DragItem: Identifiable {
    let id = UUID()
    let type: ItemType
    let title: String
    let subtitle: String
    let data: Data?
    let dateAdded: Date
}

class ShelfStorage: ObservableObject {
    @Published var items: [DragItem?] = Array(repeating: nil, count: 8)
    
    func addItem(_ item: DragItem, at index: Int) {
        guard index >= 0 && index < items.count else { return }
        items[index] = item
    }
    
    func removeItem(at index: Int) {
        guard index >= 0 && index < items.count else { return }
        items[index] = nil
    }
}

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = blendingMode
        view.state = .active
        return view
    }
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}

struct ContentView: View {
    @StateObject private var storage: ShelfStorage = ShelfStorage()
    @State private var dragOverIndex: Int? = nil
    @State private var isDragging: Bool = false
    @State private var hoveredIndex: Int? = nil
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
            
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    ForEach(0..<8, id: \.self) { index in
                        SlotView(
                            item: storage.items[index],
                            isHighlighted: dragOverIndex == index,
                            isPulsing: isDragging && storage.items[index] == nil,
                            isHovered: hoveredIndex == index
                        )
                        .onHover { isHovered in
                            hoveredIndex = isHovered ? index : nil
                        }
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
                                    withAnimation(.easeInOut(duration: 0.2)) {
                                        storage.removeItem(at: index)
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 8)
            }
        }
        .frame(width: 472, height: 68)
        .clipShape(RoundedRectangle(cornerRadius: 8))
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
                        withAnimation(.easeInOut(duration: 0.2)) {
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
                        withAnimation(.easeInOut(duration: 0.2)) {
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
                        withAnimation(.easeInOut(duration: 0.2)) {
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
    let isHovered: Bool
    
    @State private var breathingOpacity: Double = 0.3
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.clear)
                .background(
                    VisualEffectView(material: .contentBackground, blendingMode: .withinWindow)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color.white.opacity(isHovered ? 0.05 : 0))
                        .animation(.easeInOut(duration: 0.2), value: isHovered)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(isHighlighted ? Color.blue : Color.gray.opacity(0.2), lineWidth: isHighlighted ? 2 : 1)
                        .animation(.easeInOut(duration: 0.2), value: isHighlighted)
                )
            
            if let item = item {
                VStack(spacing: 2) {
                    Image(systemName: iconForItemType(item.type))
                        .font(.system(size: 20, weight: .regular, design: .default))
                        .foregroundColor(.primary)
                    
                    Text(item.title)
                        .font(.system(size: 10, weight: .regular, design: .default))
                        .lineLimit(1)
                        .foregroundColor(.primary)
                }
                .padding(4)
            } else if isPulsing {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.blue.opacity(breathingOpacity))
                    .onAppear {
                        withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) {
                            breathingOpacity = 0.1
                        }
                    }
            }
        }
        .frame(width: 52, height: 52)
    }
    
    func iconForItemType(_ type: ItemType) -> String {
        switch type {
        case .file:
            return "doc.fill"
        case .url:
            return "link"
        case .text:
            return "text.alignleft"
        }
    }
}