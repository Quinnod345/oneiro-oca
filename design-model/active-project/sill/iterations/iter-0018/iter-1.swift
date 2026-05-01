struct ContentView: View {
    @StateObject private var storage: ShelfStorage = ShelfStorage()
    @State private var dragOverIndex: Int? = nil
    @State private var isDragging: Bool = false
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
            
            VStack(spacing: 0) {
                HStack(spacing: 1) {
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
                                    withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                                        storage.removeItem(at: index)
                                    }
                                }
                            }
                        }
                        
                        if index < 7 {
                            Rectangle()
                                .fill(.separator)
                                .frame(width: 0.5, height: 44)
                        }
                    }
                }
                .padding(.horizontal, 4)
                .padding(.vertical, 4)
            }
        }
        .frame(width: 400, height: 52)
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
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
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
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
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
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
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
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.clear)
                .background(
                    VisualEffectView(material: .contentBackground, blendingMode: .withinWindow)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(isHighlighted ? Color.accentColor : Color.clear, lineWidth: 1)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .fill(isHighlighted ? Color.accentColor.opacity(0.1) : Color.clear)
                )
            
            if let item = item {
                VStack(spacing: 1) {
                    Image(systemName: iconName(for: item.type))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.secondary)
                    
                    Text(item.title)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .padding(.horizontal, 3)
                .padding(.vertical, 2)
            } else {
                Circle()
                    .fill(.quaternary)
                    .frame(width: 4, height: 4)
                    .opacity(isPulsing ? 0.3 : 0.6)
                    .scaleEffect(isPulsing ? 1.2 : 1.0)
                    .animation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true), value: isPulsing)
            }
        }
        .frame(width: 48, height: 44)
    }
    
    private func iconName(for type: DragItem.ItemType) -> String {
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

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = blendingMode
        return view
    }
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}