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
            OakGrainCanvas()
            
            VStack(spacing: 24) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Synthesis Shelf")
                            .font(.system(size: 28, weight: .semibold, design: .default))
                            .foregroundColor(Color(red: 0.15, green: 0.1, blue: 0.05))
                        
                        Text("Warm oak compartments for pending intentions")
                            .font(.system(size: 14, weight: .medium, design: .default))
                            .foregroundColor(Color(red: 0.4, green: 0.3, blue: 0.2))
                    }
                    
                    Spacer()
                    
                    Text("\(items.count)/8")
                        .font(.system(size: 13, weight: .medium, design: .monospaced))
                        .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(Color(red: 0.9, green: 0.85, blue: 0.8))
                        )
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
                            hoveredSlot = hovering ? index : nil
                        }
                    }
                }
                .padding(.horizontal, 32)
                
                Spacer()
            }
        }
        .frame(width: 1440, height: 900)
        .background(
            LinearGradient(
                colors: [
                    Color(red: 0.82, green: 0.71, blue: 0.51),
                    Color(red: 0.78, green: 0.67, blue: 0.47)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
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