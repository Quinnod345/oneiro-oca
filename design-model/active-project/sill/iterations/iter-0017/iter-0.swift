struct ContentView: View {
    @State private var shelfItems: [ShelfItem] = [
        ShelfItem(name: "ProjectSpec.pdf", type: .file, dateAdded: Date().addingTimeInterval(-86400 * 1), previewData: ShelfItem.PreviewData(thumbnailName: "doc.text", domain: nil, subtitle: "247 KB")),
        ShelfItem(name: "Screenshot 2024.png", type: .image, dateAdded: Date().addingTimeInterval(-86400 * 2), previewData: ShelfItem.PreviewData(thumbnailName: "photo", domain: nil, subtitle: "1.2 MB")),
        ShelfItem(name: "Linear Issue #1247", type: .url, dateAdded: Date().addingTimeInterval(-86400 * 4), previewData: ShelfItem.PreviewData(thumbnailName: "link", domain: "linear.app", subtitle: nil)),
        ShelfItem(name: "Meeting Notes", type: .text, dateAdded: Date().addingTimeInterval(-86400 * 6), previewData: ShelfItem.PreviewData(thumbnailName: "note.text", domain: nil, subtitle: "Draft")),
    ]
    
    @State private var draggedItem: ShelfItem?
    @State private var hoverIndex: Int?
    
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 2) {
                ForEach(0..<8, id: \.self) { index in
                    shelfSlot(for: index)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(shelfBackground)
        }
        .frame(width: 640, height: 80)
    }
    
    private func shelfSlot(for index: Int) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(
                    Color(red: 0.15, green: 0.12, blue: 0.09)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(
                            Color(red: 0.05, green: 0.04, blue: 0.03),
                            lineWidth: 0.5
                        )
                        .shadow(
                            color: Color(red: 0.0, green: 0.0, blue: 0.0).opacity(0.6),
                            radius: 1.5,
                            x: 0,
                            y: 1
                        )
                )
                .shadow(
                    color: Color(red: 0.0, green: 0.0, blue: 0.0).opacity(0.3),
                    radius: 2,
                    x: 0,
                    y: -0.5
                )
            
            if index < shelfItems.count {
                itemCard(shelfItems[index])
            }
        }
        .frame(width: 72, height: 64)
        .onDrop(of: ["public.data"], isTargeted: nil) { providers in
            handleDrop(providers: providers, at: index)
        }
        .onHover { hovering in
            hoverIndex = hovering ? index : nil
        }
    }
    
    private func itemCard(_ item: ShelfItem) -> some View {
        VStack(spacing: 2) {
            HStack(spacing: 4) {
                if let thumbnailName = item.previewData?.thumbnailName {
                    Image(systemName: thumbnailName)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(Color(red: 0.85, green: 0.82, blue: 0.75))
                } else {
                    Image(systemName: "doc")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(Color(red: 0.85, green: 0.82, blue: 0.75))
                }
                
                if let domain = item.previewData?.domain {
                    Text(domain)
                        .font(.system(size: 8, weight: .medium, design: .rounded))
                        .foregroundColor(Color(red: 0.65, green: 0.62, blue: 0.55))
                        .lineLimit(1)
                }
                
                Spacer(minLength: 0)
            }
            
            Text(item.name)
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(Color(red: 0.92, green: 0.88, blue: 0.82))
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            
            if let subtitle = item.previewData?.subtitle {
                Text(subtitle)
                    .font(.system(size: 7, weight: .regular, design: .rounded))
                    .foregroundColor(Color(red: 0.55, green: 0.52, blue: 0.45))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.28, green: 0.22, blue: 0.16),
                            Color(red: 0.22, green: 0.18, blue: 0.14)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.8, green: 0.4, blue: 0.1).opacity(1.0 - item.decayProgress),
                                    Color(red: 0.9, green: 0.5, blue: 0.2).opacity(0.8 * (1.0 - item.decayProgress)),
                                    Color.clear
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 1.0
                        )
                )
                .shadow(
                    color: Color(red: 0.0, green: 0.0, blue: 0.0).opacity(0.4),
                    radius: 1,
                    x: 0,
                    y: 0.5
                )
        )
        .scaleEffect(hoverIndex == shelfItems.firstIndex(where: { $0.id == item.id }) ? 1.02 : 1.0)
        .animation(.easeOut(duration: 0.15), value: hoverIndex)
        .onDrag {
            draggedItem = item
            return NSItemProvider(object: item.name as NSString)
        }
    }
    
    private var shelfBackground: some View {
        RoundedRectangle(cornerRadius: 10)
            .fill(
                LinearGradient(
                    colors: [
                        Color(red: 0.35, green: 0.28, blue: 0.20),
                        Color(red: 0.25, green: 0.20, blue: 0.15),
                        Color(red: 0.20, green: 0.16, blue: 0.12)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(
                        LinearGradient(
                            colors: [
                                Color(red: 0.45, green: 0.38, blue: 0.30),
                                Color(red: 0.15, green: 0.12, blue: 0.09)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        ),
                        lineWidth: 1
                    )
            )
            .shadow(
                color: Color(red: 0.0, green: 0.0, blue: 0.0).opacity(0.5),
                radius: 4,
                x: 0,
                y: 2
            )
            .shadow(
                color: Color(red: 0.0, green: 0.0, blue: 0.0).opacity(0.2),
                radius: 8,
                x: 0,
                y: 4
            )
    }
    
    private func handleDrop(providers: [NSItemProvider], at index: Int) -> Bool {
        guard let provider = providers.first else { return false }
        
        provider.loadObject(ofClass: NSString.self) { (string, error) in
            DispatchQueue.main.async {
                if let itemName = string as? String {
                    let newItem = ShelfItem(
                        name: itemName,
                        type: .file,
                        dateAdded: Date(),
                        previewData: ShelfItem.PreviewData(
                            thumbnailName: "doc",
                            domain: nil,
                            subtitle: "New"
                        )
                    )
                    
                    if index < shelfItems.count {
                        shelfItems[index] = newItem
                    } else {
                        shelfItems.append(newItem)
                    }
                }
            }
        }
        
        return true
    }
}