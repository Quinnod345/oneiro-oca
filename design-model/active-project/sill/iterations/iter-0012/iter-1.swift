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
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
            
            VStack(spacing: 24) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Synthesis Shelf")
                            .font(.system(size: 28, weight: .semibold, design: .default))
                            .foregroundStyle(.primary)
                        
                        Text("Organized storage for your creative materials")
                            .font(.system(size: 14, weight: .medium, design: .default))
                            .foregroundStyle(.secondary)
                    }
                    
                    Spacer()
                    
                    Text("\(items.count)/8")
                        .font(.system(size: 13, weight: .medium, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                }
                .padding(.horizontal, 32)
                .padding(.top, 32)
                
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 20), count: 4), spacing: 20) {
                    ForEach(0..<8, id: \.self) { index in
                        ShelfSlot(
                            item: index < items.count ? items[index] : nil,
                            isHovered: hoveredSlot == index,
                            onDragOut: createPasteboardItem
                        )
                        .frame(height: 140)
                        .onHover { hovering in
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                                hoveredSlot = hovering ? index : nil
                            }
                        }
                    }
                }
                .padding(.horizontal, 32)
                
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
    
    func updateNSView(_ visualEffectView: NSVisualEffectView, context: Context) {
        visualEffectView.material = material
        visualEffectView.blendingMode = blendingMode
    }
}

struct ShelfSlot: View {
    let item: ShelfItem?
    let isHovered: Bool
    let onDragOut: (ShelfItem) -> NSPasteboardItem?
    
    var body: some View {
        Group {
            if let item = item {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Image(systemName: iconForType(item.type))
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(.tint)
                        
                        Text(item.title)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                        
                        Spacer()
                    }
                    
                    Text(item.content)
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                    
                    Spacer()
                    
                    HStack {
                        Spacer()
                        Text(timeAgoString(from: item.dateAdded))
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(.tertiary)
                    }
                }
                .padding(16)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(.tertiary, lineWidth: 0.5)
                )
                .scaleEffect(isHovered ? 1.02 : 1.0)
                .shadow(color: .black.opacity(isHovered ? 0.1 : 0.05), radius: isHovered ? 8 : 4, y: isHovered ? 4 : 2)
                .draggable(item) {
                    VStack {
                        Image(systemName: iconForType(item.type))
                        Text(item.title)
                            .font(.caption)
                    }
                    .padding(8)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                }
            } else {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.tertiary.opacity(0.3))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(.quaternary, lineWidth: 1, lineCap: .round, lineJoin: .round, dash: [4, 4])
                    )
                    .overlay(
                        Image(systemName: "plus")
                            .font(.system(size: 20, weight: .light))
                            .foregroundStyle(.quaternary)
                    )
            }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: isHovered)
    }
    
    private func iconForType(_ type: ShelfItemType) -> String {
        switch type {
        case .text:
            return "doc.text"
        case .file:
            return "doc"
        case .image:
            return "photo"
        }
    }
    
    private func timeAgoString(from date: Date) -> String {
        let now = Date()
        let timeInterval = now.timeIntervalSince(date)
        
        if timeInterval < 3600 {
            return "\(Int(timeInterval / 60))m ago"
        } else if timeInterval < 86400 {
            return "\(Int(timeInterval / 3600))h ago"
        } else {
            return "\(Int(timeInterval / 86400))d ago"
        }
    }
}