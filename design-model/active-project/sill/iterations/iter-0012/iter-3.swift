struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(
            title: "Meeting Notes",
            content: "Discussed Q1 roadmap priorities and resource allocation for the design system updates",
            type: .text,
            dateAdded: Date().addingTimeInterval(-3600)
        ),
        ShelfItem(
            title: "Wireframe Draft",
            content: "Initial layout concepts for the dashboard redesign project",
            type: .file(URL(fileURLWithPath: "/Users/shared/wireframe.fig")),
            dateAdded: Date().addingTimeInterval(-7200)
        ),
        ShelfItem(
            title: "Reference Image",
            content: "Color palette inspiration from Scandinavian interior design",
            type: .image(NSImage()),
            dateAdded: Date().addingTimeInterval(-86400 * 3)
        ),
        ShelfItem(
            title: "Code Snippet",
            content: "SwiftUI animation timing function for the micro-interactions",
            type: .text,
            dateAdded: Date().addingTimeInterval(-86400 * 8)
        )
    ]
    
    @State private var hoveredSlot: Int? = nil
    @State private var draggedItem: ShelfItem?
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .underWindowBackground, blendingMode: .behindWindow)
                .ignoresSafeArea()
            
            VStack(spacing: 32) {
                HStack {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Synthesis Shelf")
                            .font(.system(size: 28, weight: .medium, design: .default))
                            .foregroundStyle(.primary)
                        
                        Text("Organized storage for your creative materials")
                            .font(.system(size: 15, weight: .regular, design: .default))
                            .foregroundStyle(.secondary)
                    }
                    
                    Spacer()
                    
                    Text("\(items.count)/8")
                        .font(.system(size: 14, weight: .medium, design: .default))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                }
                .padding(.horizontal, 40)
                .padding(.top, 40)
                
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 24), count: 4), spacing: 24) {
                    ForEach(0..<8, id: \.self) { index in
                        ShelfSlot(
                            item: index < items.count ? items[index] : nil,
                            isHovered: hoveredSlot == index,
                            onDragOut: createPasteboardItem
                        )
                        .frame(height: 160)
                        .onHover { hovering in
                            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                                hoveredSlot = hovering ? index : nil
                            }
                        }
                        .scaleEffect(hoveredSlot == index ? 1.02 : 1.0)
                        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: hoveredSlot == index)
                    }
                }
                .padding(.horizontal, 40)
                
                Spacer()
            }
        }
    }
    
    private func createPasteboardItem(for item: ShelfItem) -> NSPasteboardItem? {
        let pasteboardItem = NSPasteboardItem()
        
        switch item.type {
        case .text:
            pasteboardItem.setString(item.content, forType: .string)
        case .file(let url):
            pasteboardItem.setString(url.absoluteString, forType: .fileURL)
        case .image:
            pasteboardItem.setString(item.title, forType: .string)
        }
        
        return pasteboardItem
    }
}

struct ShelfSlot: View {
    let item: ShelfItem?
    let isHovered: Bool
    let onDragOut: (ShelfItem) -> NSPasteboardItem?
    
    var body: some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(.secondary.opacity(item != nil ? 0.1 : 0.05))
            .stroke(.secondary.opacity(isHovered ? 0.3 : 0.1), lineWidth: 1)
            .overlay {
                if let item = item {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Image(systemName: iconName(for: item.type))
                                .foregroundStyle(isHovered ? .accentColor : .secondary)
                                .font(.system(size: 16, weight: .medium))
                            
                            Spacer()
                            
                            Text(timeAgo(from: item.dateAdded))
                                .font(.system(size: 11, weight: .regular, design: .default))
                                .foregroundStyle(.tertiary)
                        }
                        
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.title)
                                .font(.system(size: 14, weight: .medium, design: .default))
                                .foregroundStyle(.primary)
                                .lineLimit(2)
                            
                            Text(item.content)
                                .font(.system(size: 12, weight: .regular, design: .default))
                                .foregroundStyle(.secondary)
                                .lineLimit(4)
                        }
                        
                        Spacer()
                    }
                    .padding(16)
                } else {
                    VStack {
                        Image(systemName: "plus")
                            .font(.system(size: 20, weight: .light))
                            .foregroundStyle(.tertiary)
                        
                        Text("Empty Slot")
                            .font(.system(size: 12, weight: .regular, design: .default))
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            .draggable(item?.title ?? "") {
                if let item = item {
                    SlotPreview(item: item)
                }
            }
    }
    
    private func iconName(for type: ShelfItem.ItemType) -> String {
        switch type {
        case .text:
            return "doc.text"
        case .file:
            return "doc"
        case .image:
            return "photo"
        }
    }
    
    private func timeAgo(from date: Date) -> String {
        let interval = Date().timeIntervalSince(date)
        
        if interval < 3600 {
            return "\(Int(interval / 60))m ago"
        } else if interval < 86400 {
            return "\(Int(interval / 3600))h ago"
        } else {
            return "\(Int(interval / 86400))d ago"
        }
    }
}

struct SlotPreview: View {
    let item: ShelfItem
    
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(.secondary.opacity(0.2))
            .frame(width: 120, height: 80)
            .overlay {
                VStack(spacing: 4) {
                    Image(systemName: iconName(for: item.type))
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.secondary)
                    
                    Text(item.title)
                        .font(.system(size: 10, weight: .medium, design: .default))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                }
                .padding(8)
            }
    }
    
    private func iconName(for type: ShelfItem.ItemType) -> String {
        switch type {
        case .text:
            return "doc.text"
        case .file:
            return "doc"
        case .image:
            return "photo"
        }
    }
}

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let visualEffectView = NSVisualEffectView()
        visualEffectView.material = material
        visualEffectView.blendingMode = blendingMode
        visualEffectView.state = .active
        return visualEffectView
    }
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}