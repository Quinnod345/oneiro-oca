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
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.08, blue: 0.12),
                    Color(red: 0.08, green: 0.12, blue: 0.18),
                    Color(red: 0.06, green: 0.10, blue: 0.15)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
                .opacity(0.4)
            
            VStack(spacing: 32) {
                HStack {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Synthesis Shelf")
                            .font(.system(size: 32, weight: .bold, design: .rounded))
                            .foregroundStyle(
                                LinearGradient(
                                    colors: [.white, Color(red: 0.85, green: 0.9, blue: 1.0)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                        
                        Text("Organized storage for your creative materials")
                            .font(.system(size: 15, weight: .medium, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                    
                    Spacer()
                    
                    Text("\(items.count)/8")
                        .font(.system(size: 14, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.2, green: 0.4, blue: 0.8),
                                    Color(red: 0.3, green: 0.5, blue: 0.9)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            in: RoundedRectangle(cornerRadius: 12)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color.white.opacity(0.2), lineWidth: 1)
                        )
                        .shadow(color: .black.opacity(0.3), radius: 8, y: 4)
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
                        .scaleEffect(hoveredSlot == index ? 1.05 : 1.0)
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
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        ZStack {
                            Circle()
                                .fill(
                                    LinearGradient(
                                        colors: gradientForType(item.type),
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                                .frame(width: 32, height: 32)
                                .shadow(color: .black.opacity(0.3), radius: 4, y: 2)
                            
                            Image(systemName: iconForType(item.type))
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(.white)
                                .symbolRenderingMode(.hierarchical)
                        }
                        
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title)
                                .font(.system(size: 15, weight: .semibold, design: .rounded))
                                .foregroundStyle(.white)
                                .lineLimit(1)
                            
                            Text(timeAgoString(from: item.dateAdded))
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(.secondary)
                        }
                        
                        Spacer()
                    }
                    
                    Text(item.content)
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(Color.white.opacity(0.8))
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                    
                    Spacer()
                }
                .padding(20)
                .background(
                    ZStack {
                        RoundedRectangle(cornerRadius: 16)
                            .fill(
                                LinearGradient(
                                    colors: [
                                        Color.white.opacity(0.1),
                                        Color.white.opacity(0.05)
                                    ],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                        
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(
                                LinearGradient(
                                    colors: [
                                        Color.white.opacity(0.3),
                                        Color.white.opacity(0.1)
                                    ],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                lineWidth: 1
                            )
                    }
                )
                .shadow(color: .black.opacity(0.2), radius: 12, y: 6)
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color.white.opacity(isHovered ? 0.1 : 0))
                        .animation(.easeInOut(duration: 0.2), value: isHovered)
                )
            } else {
                VStack {
                    Spacer()
                    
                    ZStack {
                        Circle()
                            .stroke(
                                Color.white.opacity(0.2),
                                style: StrokeStyle(lineWidth: 2, dash: [8, 4])
                            )
                            .frame(width: 40, height: 40)
                        
                        Image(systemName: "plus")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.4))
                    }
                    
                    Spacer()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(
                            Color.white.opacity(isHovered ? 0.3 : 0.1),
                            style: StrokeStyle(lineWidth: 2, dash: [12, 6])
                        )
                        .animation(.easeInOut(duration: 0.2), value: isHovered)
                )
            }
        }
    }
    
    private func iconForType(_ type: ShelfItemType) -> String {
        switch type {
        case .text:
            return "doc.text.fill"
        case .file:
            return "folder.fill"
        case .image:
            return "photo.fill"
        }
    }
    
    private func gradientForType(_ type: ShelfItemType) -> [Color] {
        switch type {
        case .text:
            return [Color(red: 0.3, green: 0.6, blue: 1.0), Color(red: 0.2, green: 0.4, blue: 0.8)]
        case .file:
            return [Color(red: 0.8, green: 0.4, blue: 1.0), Color(red: 0.6, green: 0.3, blue: 0.8)]
        case .image:
            return [Color(red: 1.0, green: 0.5, blue: 0.3), Color(red: 0.8, green: 0.3, blue: 0.2)]
        }
    }
    
    private func timeAgoString(from date: Date) -> String {
        let now = Date()
        let timeInterval = now.timeIntervalSince(date)
        
        if timeInterval < 3600 {
            let minutes = Int(timeInterval / 60)
            return "\(minutes)m ago"
        } else if timeInterval < 86400 {
            let hours = Int(timeInterval / 3600)
            return "\(hours)h ago"
        } else {
            let days = Int(timeInterval / 86400)
            return "\(days)d ago"
        }
    }
}