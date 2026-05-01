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
            HStack(spacing: 4) {
                ForEach(0..<8, id: \.self) { index in
                    shelfSlot(for: index)
                }
            }
            .padding(16)
            .background(
                VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
                    .overlay(
                        Color.black.opacity(0.1)
                    )
            )
        }
        .frame(width: 640, height: 96)
    }
    
    private func shelfSlot(for index: Int) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.black.opacity(0.2))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(Color.white.opacity(0.1), lineWidth: 0.5)
                )
                .shadow(color: .black.opacity(0.15), radius: 2, x: 0, y: 1)
            
            if index < shelfItems.count {
                itemCard(shelfItems[index], index: index)
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
    
    private func itemCard(_ item: ShelfItem, index: Int) -> some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                if let thumbnailName = item.previewData?.thumbnailName {
                    Image(systemName: thumbnailName)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.accentColor)
                } else {
                    Image(systemName: "doc")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.accentColor)
                }
                
                if let domain = item.previewData?.domain {
                    Text(domain)
                        .font(.system(size: 8, weight: .medium))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
                
                Spacer(minLength: 0)
            }
            
            Text(item.name)
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.primary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            
            if let subtitle = item.previewData?.subtitle {
                Text(subtitle)
                    .font(.system(size: 8, weight: .regular))
                    .foregroundColor(.tertiary)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            
            Spacer(minLength: 0)
        }
        .padding(8)
        .background(
            VisualEffectView(material: .hudWindow, blendingMode: .behindWindow)
                .clipShape(RoundedRectangle(cornerRadius: 6))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .strokeBorder(Color.white.opacity(0.1), lineWidth: 0.5)
        )
        .scaleEffect(hoverIndex == index ? 1.05 : 1.0)
        .animation(.easeInOut(duration: 0.15), value: hoverIndex)
    }
    
    private func handleDrop(providers: [NSItemProvider], at index: Int) -> Bool {
        return false
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
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}