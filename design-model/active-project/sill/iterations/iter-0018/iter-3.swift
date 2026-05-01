struct ContentView: View {
    @StateObject private var storage = ShelfStorage()
    @State private var dragOverIndex: Int?
    @State private var isDragging = false
    @State private var hoveredIndex: Int?
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
            
            VStack(spacing: 0) {
                if storage.items.allSatisfy({ $0 == nil }) && !isDragging {
                    Text("Drop files, URLs, or text here")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.secondary)
                        .frame(height: 52)
                        .transition(.opacity.animation(.easeInOut(duration: 0.3)))
                } else {
                    HStack(spacing: 8) {
                        ForEach(0..<8, id: \.self) { index in
                            SlotView(
                                item: storage.items[index],
                                isHighlighted: dragOverIndex == index,
                                isPulsing: isDragging && storage.items[index] == nil,
                                isHovered: hoveredIndex == index
                            )
                            .scaleEffect(dragOverIndex == index ? 1.05 : (hoveredIndex == index ? 1.02 : 1.0))
                            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: dragOverIndex == index)
                            .animation(.spring(response: 0.2, dampingFraction: 0.8), value: hoveredIndex == index)
                            .onHover { isHovered in
                                withAnimation(.easeInOut(duration: 0.15)) {
                                    hoveredIndex = isHovered ? index : nil
                                }
                            }
                            .onDrop(of: ["public.file-url", "public.plain-text", "public.url"], isTargeted: Binding(
                                get: { dragOverIndex == index },
                                set: { isTargeted in
                                    withAnimation(.spring(response: 0.2, dampingFraction: 0.9)) {
                                        if isTargeted {
                                            dragOverIndex = index
                                            isDragging = true
                                        } else if dragOverIndex == index {
                                            dragOverIndex = nil
                                        }
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
                        }
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 8)
                    .transition(.scale.combined(with: .opacity).animation(.spring(response: 0.4, dampingFraction: 0.8)))
                }
            }
        }
        .frame(width: 472, height: 68)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.primary.opacity(0.1), lineWidth: 0.5)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .shadow(color: .black.opacity(0.1), radius: 4, x: 0, y: 2)
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didChangeOcclusionStateNotification)) { _ in
            isDragging = false
            dragOverIndex = nil
        }
    }
    
    private func handleDrop(providers: [NSItemProvider], at index: Int) -> Bool {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
            isDragging = false
            dragOverIndex = nil
        }
        
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
                            subtitle: string,
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
    let isHovered: Bool
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(item != nil ? Color.accentColor.opacity(0.1) : Color.clear)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(
                            isHighlighted ? Color.accentColor :
                            (isHovered ? Color.primary.opacity(0.3) :
                             Color.primary.opacity(item != nil ? 0.2 : 0.1)),
                            lineWidth: isHighlighted || isHovered ? 1 : 0.5
                        )
                )
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(
                            isHighlighted ? Color.accentColor.opacity(0.1) :
                            (isPulsing ? Color.primary.opacity(0.05) : Color.clear)
                        )
                )
            
            if let item = item {
                VStack(spacing: 2) {
                    HStack(spacing: 4) {
                        iconForItemType(item.type)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.accentColor)
                        
                        Text(item.title)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.primary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                    
                    Text(item.subtitle)
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
                .help("\(item.title)\n\(item.subtitle)\nAdded: \(DateFormatter.short.string(from: item.dateAdded))")
            } else if isPulsing {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.secondary)
                    .opacity(0.6)
                    .scaleEffect(isPulsing ? 1.1 : 1.0)
                    .animation(
                        isPulsing ? .easeInOut(duration: 0.8).repeatForever(autoreverses: true) : .default,
                        value: isPulsing
                    )
            }
        }
        .frame(width: 52, height: 52)
    }
    
    private func iconForItemType(_ type: ItemType) -> Image {
        switch type {
        case .file:
            return Image(systemName: "doc.fill")
        case .url:
            return Image(systemName: "link")
        case .text:
            return Image(systemName: "text.quote")
        }
    }
}

extension DateFormatter {
    static let short: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }()
}