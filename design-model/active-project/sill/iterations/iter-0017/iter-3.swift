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
            HStack(spacing: 8) {
                ForEach(0..<6, id: \.self) { index in
                    shelfSlot(for: index)
                }
            }
            .padding(16)
            .background(
                VisualEffectView(material: .popover, blendingMode: .behindWindow)
            )
        }
        .frame(width: 800, height: 140)
    }
    
    private func shelfSlot(for index: Int) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.primary.opacity(0.04))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(Color.primary.opacity(0.06), lineWidth: 1)
                )
            
            if index < shelfItems.count {
                itemCard(shelfItems[index], index: index)
            }
        }
        .frame(width: 120, height: 90)
        .onDrop(of: ["public.data"], isTargeted: nil) { providers in
            handleDrop(providers: providers, at: index)
        }
        .onHover { hovering in
            hoverIndex = hovering ? index : nil
        }
    }
    
    private func itemCard(_ item: ShelfItem, index: Int) -> some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                if let thumbnailName = item.previewData?.thumbnailName {
                    Image(systemName: thumbnailName)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.accentColor)
                } else {
                    Image(systemName: "doc")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.accentColor)
                }
                
                if let domain = item.previewData?.domain {
                    Text(domain)
                        .font(.system(size: 12, weight: .regular))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                
                Spacer(minLength: 0)
            }
            
            Text(item.name)
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(.primary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .truncationMode(.tail)
                .help(item.name)
            
            if let subtitle = item.previewData?.subtitle {
                Text(subtitle)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundColor(.tertiary)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .truncationMode(.tail)
            }
            
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(
            VisualEffectView(material: .popover, blendingMode: .behindWindow)
                .clipShape(RoundedRectangle(cornerRadius: 10))
        )
        .shadow(radius: hoverIndex == index ? 8 : 2)
        .offset(y: hoverIndex == index ? -2 : 0)
        .animation(.easeInOut(duration: 0.2), value: hoverIndex)
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