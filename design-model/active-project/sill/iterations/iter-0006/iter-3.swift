struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(name: "Meeting Notes", type: .text, dateAdded: Date().addingTimeInterval(-3600), content: "Quarterly review discussion points..."),
        ShelfItem(name: "Design.sketch", type: .file, dateAdded: Date().addingTimeInterval(-86400 * 2), content: ""),
        ShelfItem(name: "Inspiration", type: .image, dateAdded: Date().addingTimeInterval(-86400 * 5), content: ""),
        ShelfItem(name: "Linear", type: .url, dateAdded: Date().addingTimeInterval(-86400 * 10), content: "linear.app")
    ]
    
    @State private var dragOver: Int? = nil
    @State private var hoveredSlot: Int? = nil
    
    var body: some View {
        VStack(spacing: 16) {
            HStack {
                Text("Shelf")
                    .font(.system(size: 22, weight: .medium, design: .default))
                    .foregroundColor(.primary)
                
                Spacer()
                
                Text("\(items.count) of 8 items")
                    .font(.system(size: 11, weight: .regular, design: .default))
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal, 16)
            
            HStack(spacing: 12) {
                ForEach(0..<8, id: \.self) { index in
                    ShelfSlot(
                        item: index < items.count ? items[index] : nil,
                        isDropTarget: dragOver == index,
                        isHovered: hoveredSlot == index
                    )
                    .scaleEffect(hoveredSlot == index ? 1.02 : 1.0)
                    .animation(.easeInOut(duration: 0.15), value: hoveredSlot)
                    .onHover { hovering in
                        withAnimation(.easeInOut(duration: 0.15)) {
                            hoveredSlot = hovering ? index : nil
                        }
                    }
                    .onDrop(of: [.text, .fileURL, .image], isTargeted: Binding(
                        get: { dragOver == index },
                        set: { newValue in
                            if newValue {
                                dragOver = index
                            } else if dragOver == index {
                                dragOver = nil
                            }
                        }
                    )) { providers in
                        handleDrop(providers: providers, at: index)
                        return true
                    }
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.vertical, 16)
        .background(VisualEffectBackground(material: .hudWindow, blendingMode: .behindWindow))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color(NSColor.separatorColor), lineWidth: 0.5)
        )
    }
    
    private func handleDrop(providers: [NSItemProvider], at index: Int) -> Void {
        guard let provider = providers.first else { return }
        
        if provider.hasItemConformingToTypeIdentifier("public.plain-text") {
            provider.loadItem(forTypeIdentifier: "public.plain-text", options: nil) { (data, error) in
                if let text = data as? String {
                    DispatchQueue.main.async {
                        addItem(name: "Text Note", type: .text, content: text, at: index)
                    }
                }
            }
        } else if provider.hasItemConformingToTypeIdentifier("public.file-url") {
            provider.loadItem(forTypeIdentifier: "public.file-url", options: nil) { (data, error) in
                if let url = data as? URL {
                    DispatchQueue.main.async {
                        addItem(name: url.lastPathComponent, type: .file, content: url.path, at: index)
                    }
                }
            }
        }
    }
    
    private func addItem(name: String, type: ShelfItem.ItemType, content: String, at index: Int) -> Void {
        let newItem = ShelfItem(name: name, type: type, dateAdded: Date(), content: content)
        
        withAnimation(.easeInOut(duration: 0.2)) {
            if index < items.count {
                items[index] = newItem
            } else {
                items.append(newItem)
            }
            dragOver = nil
        }
    }
}

struct ShelfSlot: View {
    let item: ShelfItem?
    let isDropTarget: Bool
    let isHovered: Bool
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(NSColor.controlBackgroundColor))
                .frame(width: 110, height: 110)
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color(NSColor.separatorColor), lineWidth: 0.5)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(
                            isDropTarget ? Color.accentColor : Color.clear,
                            lineWidth: isDropTarget ? 2 : 0
                        )
                        .animation(.easeInOut(duration: 0.15), value: isDropTarget)
                )
            
            if let item = item {
                VStack(spacing: 6) {
                    Image(systemName: item.type.iconName)
                        .font(.system(size: 24, weight: .medium))
                        .foregroundColor(.primary)
                    
                    Text(item.name)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.primary)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                        .frame(width: 90)
                }
            } else {
                Image(systemName: "plus")
                    .font(.system(size: 20, weight: .light))
                    .foregroundColor(.secondary)
                    .opacity(isDropTarget ? 0.8 : 0.4)
            }
        }
    }
}

struct VisualEffectBackground: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = blendingMode
        view.state = .active
        view.wantsLayer = true
        view.layer?.cornerRadius = 8
        return view
    }
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}

struct ShelfItem {
    let name: String
    let type: ItemType
    let dateAdded: Date
    let content: String
    
    enum ItemType {
        case text, file, image, url
        
        var iconName: String {
            switch self {
            case .text: return "doc.text"
            case .file: return "doc"
            case .image: return "photo"
            case .url: return "link"
            }
        }
    }
}