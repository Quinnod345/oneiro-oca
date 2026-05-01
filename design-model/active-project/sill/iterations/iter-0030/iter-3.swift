struct ContentView: View {
    @StateObject private var store: ShelfStore = ShelfStore()
    @State private var dragOver: Bool = false
    @State private var insertionIndex: Int? = nil
    @State private var dragOffset: CGFloat = 0
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
            
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    Text("Shelf")
                        .font(.system(size: 13, weight: .medium, design: .default))
                        .foregroundColor(.primary)
                    
                    Spacer()
                    
                    Text("\(store.items.count) items")
                        .font(.system(size: 11, weight: .regular))
                        .foregroundColor(.secondary)
                }
                .padding(.horizontal, 24)
                .padding(.top, 16)
                
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 16) {
                        ForEach(Array(store.items.enumerated()), id: \.element.id) { index, item in
                            ItemView(
                                item: item,
                                index: index,
                                onRemove: { item in
                                    withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                                        store.removeItem(item)
                                    }
                                },
                                onMove: { from, to in
                                    store.moveItem(from: from, to: to)
                                }
                            )
                            .transition(.asymmetric(
                                insertion: .scale.combined(with: .opacity),
                                removal: .scale.combined(with: .opacity)
                            ))
                        }
                        
                        if insertionIndex != nil {
                            InsertionIndicator()
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 16)
                }
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(dragOver ? Color.accentColor.opacity(0.1) : Color.clear)
                        .padding(.horizontal, 16)
                )
                
                Spacer()
            }
        }
        .frame(height: 140)
        .background(VisualEffectView(material: .titlebar, blendingMode: .behindWindow))
        .onDrop(of: ["public.text", "public.url", "public.file-url"], isTargeted: $dragOver) { providers -> Bool in
            handleDrop(providers)
        }
        .animation(.spring(response: 0.5, dampingFraction: 0.7), value: dragOver)
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: store.items.count)
    }
    
    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        guard let provider = providers.first else { return false }
        
        if provider.hasItemConformingToTypeIdentifier("public.url") {
            provider.loadItem(forTypeIdentifier: "public.url", options: nil) { data, _ in
                if let url = data as? URL {
                    DispatchQueue.main.async {
                        let item = ShelfItem(
                            content: url.absoluteString,
                            type: determineFileType(from: url),
                            createdAt: Date()
                        )
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                            store.addItem(item, at: insertionIndex)
                            insertionIndex = nil
                        }
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
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                            store.addItem(item, at: insertionIndex)
                            insertionIndex = nil
                        }
                    }
                }
            }
            return true
        }
        
        return false
    }
    
    private func determineFileType(from url: URL) -> ShelfItem.ItemType {
        let imageExtensions = ["png", "jpg", "jpeg", "gif", "webp", "svg"]
        let fileExtension = url.pathExtension.lowercased()
        
        if imageExtensions.contains(fileExtension) {
            return .image
        } else if url.scheme == "http" || url.scheme == "https" {
            return .url
        } else {
            return .file
        }
    }
}

struct ItemView: View {
    let item: ShelfItem
    let index: Int
    let onRemove: (ShelfItem) -> Void
    let onMove: (Int, Int) -> Void
    
    @State private var isDragging: Bool = false
    @State private var isHovering: Bool = false
    @State private var dragOffset: CGSize = .zero
    @State private var showDeleteConfirmation: Bool = false
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10)
                .fill(.regularMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(Color.quaternaryLabel, lineWidth: 1)
                )
                .shadow(color: .black.opacity(isDragging ? 0.2 : isHovering ? 0.1 : 0.05), radius: isDragging ? 8 : 4, x: 0, y: 2)
            
            VStack(spacing: 4) {
                Image(systemName: iconName)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundColor(.secondary)
                
                Text(displayText)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(.primary)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 60)
            }
            .padding(8)
        }
        .frame(width: 70, height: 70)
        .scaleEffect(isDragging ? 0.98 : isHovering ? 1.02 : 1.0)
        .offset(dragOffset)
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.15)) {
                isHovering = hovering
            }
        }
        .onTapGesture(count: 2) {
            openItem()
        }
        .contextMenu {
            Button("Open") {
                openItem()
            }
            Divider()
            Button("Remove", role: .destructive) {
                onRemove(item)
            }
        }
        .gesture(
            DragGesture(coordinateSpace: .global)
                .onChanged { value in
                    if !isDragging {
                        isDragging = true
                    }
                    dragOffset = value.translation
                }
                .onEnded { value in
                    isDragging = false
                    dragOffset = .zero
                }
        )
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isDragging)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovering)
    }
    
    private var iconName: String {
        switch item.type {
        case .text:
            return "doc.text"
        case .url:
            return "link"
        case .image:
            return "photo"
        case .file:
            return "doc"
        }
    }
    
    private var displayText: String {
        switch item.type {
        case .text:
            return String(item.content.prefix(20))
        case .url:
            if let url = URL(string: item.content) {
                return url.host ?? "URL"
            }
            return "URL"
        case .image, .file:
            if let url = URL(string: item.content) {
                return url.lastPathComponent
            }
            return "File"
        }
    }
    
    private func openItem() {
        switch item.type {
        case .url, .file, .image:
            if let url = URL(string: item.content) {
                NSWorkspace.shared.open(url)
            }
        case .text:
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(item.content, forType: .string)
        }
    }
}

struct InsertionIndicator: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Color.accentColor.opacity(0.3))
            .frame(width: 4, height: 50)
            .animation(.easeInOut(duration: 0.2), value: true)
    }
}