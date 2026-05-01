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
            HStack(spacing: 6) {
                ForEach(0..<8, id: \.self) { index in
                    shelfSlot(for: index)
                }
            }
            .padding(16)
            .background(
                VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
            )
        }
        .frame(width: 760, height: 112)
    }
    
    private func shelfSlot(for index: Int) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.primary.opacity(0.06))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
                )
            
            if index < shelfItems.count {
                itemCard(shelfItems[index], index: index)
            }
        }
        .frame(width: 88, height: 72)
        .onDrop(of: ["public.data"], isTargeted: nil) { providers in
            handleDrop(providers: providers, at: index)
        }
        .onHover { hovering in
            hoverIndex = hovering ? index : nil
        }
    }
    
    private func itemCard(_ item: ShelfItem, index: Int) -> some View {
        VStack(spacing: 4) {
            HStack(spacing: 5) {
                if let thumbnailName = item.previewData?.thumbnailName {
                    Image(systemName: thumbnailName)
                        .font(.system(size: 14, weight: .medium, design: .default))
                        .foregroundColor(.accentColor)
                } else {
                    Image(systemName: "doc")
                        .font(.system(size: 14, weight: .medium, design: .default))
                        .foregroundColor(.accentColor)
                }
                
                if let domain = item.previewData?.domain {
                    Text(domain)
                        .font(.system(size: 11, weight: .regular, design: .default))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
                
                Spacer(minLength: 0)
            }
            
            Text(item.name)
                .font(.system(size: 13, weight: .medium, design: .default))
                .foregroundColor(.primary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            
            if let subtitle = item.previewData?.subtitle {
                Text(subtitle)
                    .font(.system(size: 11, weight: .regular, design: .default))
                    .foregroundColor(.tertiary)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(
            VisualEffectView(material: .hudWindow, blendingMode: .behindWindow)
                .clipShape(RoundedRectangle(cornerRadius: 8))
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