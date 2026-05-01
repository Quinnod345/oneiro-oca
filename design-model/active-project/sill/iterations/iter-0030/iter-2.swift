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
                .padding(.horizontal, 20)
                .padding(.top, 12)
                
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 12) {
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
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                }
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(dragOver ? Color(red: 0.6, green: 0.7, blue: 0.6, opacity: 0.15) : Color.clear)
                        .padding(.horizontal, 12)
                )
            }
        }
        .frame(height: 110)
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
                        .stroke(
                            isDragging ? 
                            Color(red: 0.9, green: 0.6, blue: 0.6, opacity: 0.8) :
                            (isHovering ? 
                             Color(red: 0.6, green: 0.7, blue: 0.6, opacity: 0.6) : 
                             Color.primary.opacity(0.08)), 
                            lineWidth: isDragging ? 1.5 : (isHovering ? 1.0 : 0.5)
                        )
                )
                .shadow(
                    color: .black.opacity(isDragging ? 0.25 : (isHovering ? 0.15 : 0.08)), 
                    radius: isDragging ? 6 : (isHovering ? 4 : 2), 
                    x: 0, 
                    y: isDragging ? 3 : (isHovering ? 2 : 1)
                )
            
            ItemPreview(item: item)
                .opacity(item.isDecayed ? 0.4 : 1.0)
                .scaleEffect(isDragging ? 0.92 : (isHovering ? 1.05 : 1.0))
                .offset(dragOffset)
        }
        .frame(width: 80, height: 64)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isDragging)
        .animation(.spring(response: 0.2, dampingFraction: 0.8), value: isHovering)
        .onHover { hovering in
            isHovering = hovering
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
                    if value.translation.y > 50 {
                        NSHapticFeedbackManager.defaultPerformer.perform(.levelChange, performanceTime: .default)
                        onRemove(item)
                    }
                    
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                        isDragging = false
                        dragOffset = .zero
                    }
                }
        )
    }
}

struct ItemPreview: View {
    let item: ShelfItem
    
    var body: some View {
        VStack(spacing: 3) {
            Image(systemName: iconName)
                .font(.system(size: 18, weight: .medium))
                .foregroundColor(iconColor)
            
            Text(displayText)
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(.secondary)
                .lineLimit(2)
                .multilineTextAlignment(.center)
        }
        .padding(6)
    }
    
    private var iconName: String {
        switch item.type {
        case .text:
            return "text.alignleft"
        case .url:
            return "link"
        case .image:
            return "photo"
        case .file:
            return "doc"
        }
    }
    
    private var iconColor: Color {
        switch item.type {
        case .text:
            return Color(red: 0.4, green: 0.6, blue: 0.8)
        case .url:
            return Color(red: 0.6, green: 0.7, blue: 0.6)
        case .image:
            return Color(red: 0.9, green: 0.6, blue: 0.6)
        case .file:
            return Color(red: 0.7, green: 0.6, blue: 0.8)
        }
    }
    
    private var displayText: String {
        let maxLength = 20
        if item.content.count > maxLength {
            return String(item.content.prefix(maxLength)) + "..."
        }
        return item.content
    }
}

struct InsertionIndicator: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 10)
            .fill(Color(red: 0.6, green: 0.7, blue: 0.6, opacity: 0.3))
            .frame(width: 80, height: 64)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color(red: 0.6, green: 0.7, blue: 0.6), style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
            )
    }
}