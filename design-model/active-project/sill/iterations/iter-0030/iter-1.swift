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
                .padding(.horizontal, 16)
                .padding(.top, 8)
                
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 8) {
                        ForEach(Array(store.items.enumerated()), id: \.element.id) { index, item in
                            ItemView(
                                item: item,
                                index: index,
                                onRemove: { item in
                                    store.removeItem(item)
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
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
                .background(
                    dragOver ? 
                    Color.accentColor.opacity(0.1) : 
                    Color.clear
                )
            }
        }
        .frame(height: 90)
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
                        store.addItem(item, at: insertionIndex)
                        insertionIndex = nil
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
                        store.addItem(item, at: insertionIndex)
                        insertionIndex = nil
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
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(.regularMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.primary.opacity(0.1), lineWidth: 0.5)
                )
                .shadow(color: .black.opacity(0.1), radius: 2, x: 0, y: 1)
            
            ItemPreview(item: item)
                .opacity(item.isDecayed ? 0.5 : 1.0)
                .scaleEffect(isDragging ? 0.95 : (isHovering ? 1.02 : 1.0))
                .offset(dragOffset)
        }
        .frame(width: 64, height: 56)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isDragging)
        .animation(.spring(response: 0.2, dampingFraction: 0.8), value: isHovering)
        .onHover { hovering in
            isHovering = hovering
        }
        .draggable(item.content) {
            ItemPreview(item: item)
                .frame(width: 64, height: 56)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                .opacity(0.9)
                .scaleEffect(0.9)
        }
        .simultaneousGesture(
            DragGesture(coordinateSpace: .global)
                .onChanged { value in
                    isDragging = true
                    dragOffset = value.translation
                }
                .onEnded { value in
                    isDragging = false
                    dragOffset = .zero
                    
                    let threshold: CGFloat = 40
                    if value.translation.magnitude > threshold {
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                            onRemove(item)
                        }
                    }
                }
        )
        .contextMenu {
            Button("Remove from Shelf") {
                onRemove(item)
            }
            
            Button("Copy") {
                let pasteboard = NSPasteboard.general
                pasteboard.clearContents()
                pasteboard.setString(item.content, forType: .string)
            }
        }
    }
}

struct ItemPreview: View {
    let item: ShelfItem
    
    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: iconName)
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(iconColor)
            
            Text(displayText)
                .font(.system(size: 11, weight: .medium))
                .lineLimit(1)
                .truncationMode(.middle)
                .foregroundStyle(.primary)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
    }
    
    private var iconName: String {
        switch item.type {
        case .text:
            return "doc.text.fill"
        case .url:
            return "link"
        case .image:
            return "photo.fill"
        case .file:
            return "doc.fill"
        }
    }
    
    private var iconColor: Color {
        switch item.type {
        case .text:
            return .blue
        case .url:
            return .green
        case .image:
            return .orange
        case .file:
            return .purple
        }
    }
    
    private var displayText: String {
        switch item.type {
        case .text:
            return String(item.content.prefix(12))
        case .url:
            if let host = URL(string: item.content)?.host {
                return host
            }
            return "Link"
        case .image, .file:
            if let url = URL(string: item.content) {
                return url.lastPathComponent
            }
            return "File"
        }
    }
}

struct InsertionIndicator: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Color.accentColor.opacity(0.3))
            .frame(width: 64, height: 56)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.accentColor, lineWidth: 2)
                    .scaleEffect(0.9)
            )
            .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: UUID())
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

extension CGSize {
    var magnitude: CGFloat {
        sqrt(width * width + height * height)
    }
}