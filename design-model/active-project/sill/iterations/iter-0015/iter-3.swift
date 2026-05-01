struct ContentView: View {
    @StateObject private var slotManager = SlotManager()
    @State private var hoveredIndex: Int? = nil
    @State private var isDraggingOver: Bool = false
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
                .ignoresSafeArea()
            
            VStack(spacing: 32) {
                VStack(spacing: 8) {
                    Text("Memory Shelf")
                        .font(.system(size: 42, weight: .bold, design: .default))
                        .foregroundColor(Color(NSColor.labelColor))
                    
                    Text("Your personal collection of memories and moments")
                        .font(.system(size: 16, weight: .medium, design: .default))
                        .foregroundColor(Color(NSColor.secondaryLabelColor))
                }
                
                ZStack {
                    ShelfBackground()
                    
                    let columns = [
                        GridItem(.flexible(), spacing: 20),
                        GridItem(.flexible(), spacing: 20),
                        GridItem(.flexible(), spacing: 20),
                        GridItem(.flexible(), spacing: 20)
                    ]
                    
                    LazyVGrid(columns: columns, spacing: 20) {
                        ForEach(0..<8) { index in
                            let item = index < slotManager.items.count ? slotManager.items[index] : nil
                            
                            SlotView(
                                item: item,
                                isHovering: hoveredIndex == index || (isDraggingOver && item == nil),
                                slotIndex: index
                            )
                            .rotation3DEffect(
                                .degrees(hoveredIndex == index ? -5 : 0),
                                axis: (x: 1, y: 0, z: 0),
                                anchor: .bottom,
                                perspective: 0.8
                            )
                            .scaleEffect(hoveredIndex == index ? 1.05 : 1.0)
                            .shadow(
                                color: Color.black.opacity(hoveredIndex == index ? 0.3 : 0.1),
                                radius: hoveredIndex == index ? 15 : 8,
                                x: 0,
                                y: hoveredIndex == index ? 8 : 4
                            )
                            .onHover { hovering in
                                withAnimation(.easeOut(duration: 0.3)) {
                                    hoveredIndex = hovering ? index : nil
                                }
                                if hovering {
                                    NSCursor.pointingHand.push()
                                } else {
                                    NSCursor.pop()
                                }
                            }
                            .onTapGesture {
                                if let item = item {
                                    copyToPasteboard(item)
                                }
                            }
                            .contextMenu {
                                if let item = item {
                                    Button("Copy") {
                                        copyToPasteboard(item)
                                    }
                                    Button("Remove") {
                                        slotManager.removeItem(item)
                                    }
                                }
                            }
                            .onDrop(of: [.fileURL, .utf8PlainText, .image], isTargeted: .constant(false)) { providers in
                                handleDrop(providers)
                                return true
                            }
                        }
                    }
                    .padding(32)
                }
                .frame(maxWidth: 700, maxHeight: 400)
            }
            .padding(40)
        }
        .frame(width: 800, height: 600)
        .onDrop(of: [.fileURL, .utf8PlainText, .image], isTargeted: $isDraggingOver) { providers in
            handleDrop(providers)
            return true
        }
    }
    
    func copyToPasteboard(_ item: SlotItem) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        
        switch item.type {
        case .text:
            if let text = String(data: item.data, encoding: .utf8) {
                pasteboard.setString(text, forType: .string)
            }
        case .image:
            if let image = NSImage(data: item.data) {
                pasteboard.setData(item.data, forType: .tiff)
            }
        case .file:
            pasteboard.setData(item.data, forType: .fileURL)
        }
    }
    
    func handleDrop(_ providers: [NSItemProvider]) {
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.utf8PlainText.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.utf8PlainText.identifier, options: nil) { item, error in
                    if let data = item as? Data, let text = String(data: data, encoding: .utf8) {
                        DispatchQueue.main.async {
                            let slotItem = SlotItem(
                                title: String(text.prefix(20)),
                                type: .text,
                                data: data,
                                createdAt: Date()
                            )
                            slotManager.addItem(slotItem)
                        }
                    }
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { item, error in
                    if let data = item as? Data {
                        DispatchQueue.main.async {
                            let slotItem = SlotItem(
                                title: "Image",
                                type: .image,
                                data: data,
                                createdAt: Date()
                            )
                            slotManager.addItem(slotItem)
                        }
                    }
                }
            }
        }
    }
}

struct ShelfBackground: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 16)
                .fill(Color(NSColor.controlBackgroundColor))
                .shadow(color: Color.black.opacity(0.1), radius: 20, x: 0, y: 10)
            
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color(NSColor.separatorColor).opacity(0.3), lineWidth: 1)
        }
    }
}

struct SlotView: View {
    let item: SlotItem?
    let isHovering: Bool
    let slotIndex: Int
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(NSColor.textBackgroundColor))
                .stroke(
                    isHovering ? Color.accentColor : Color(NSColor.separatorColor),
                    lineWidth: isHovering ? 2 : 1
                )
                .frame(width: 120, height: 120)
            
            if let item = item {
                VStack(spacing: 8) {
                    switch item.type {
                    case .text:
                        Image(systemName: "doc.text.fill")
                            .font(.system(size: 32))
                            .foregroundColor(Color(NSColor.labelColor))
                    case .image:
                        if let nsImage = NSImage(data: item.data) {
                            Image(nsImage: nsImage)
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .frame(width: 60, height: 60)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        } else {
                            Image(systemName: "photo.fill")
                                .font(.system(size: 32))
                                .foregroundColor(Color(NSColor.labelColor))
                        }
                    case .file:
                        Image(systemName: "doc.fill")
                            .font(.system(size: 32))
                            .foregroundColor(Color(NSColor.labelColor))
                    }
                    
                    Text(item.title)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(Color(NSColor.secondaryLabelColor))
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                        .frame(width: 100)
                }
            } else {
                VStack(spacing: 8) {
                    Image(systemName: isHovering ? "plus.circle.fill" : "plus.circle")
                        .font(.system(size: 32))
                        .foregroundColor(isHovering ? Color.accentColor : Color(NSColor.tertiaryLabelColor))
                    
                    Text("Drop here")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(Color(NSColor.tertiaryLabelColor))
                }
                .opacity(isHovering ? 1.0 : 0.6)
            }
        }
    }
}