struct ContentView: View {
    @StateObject private var slotManager = SlotManager()
    @State private var hoveredIndex: Int? = nil
    @State private var isDraggingOver: Bool = false
    
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.96, green: 0.97, blue: 0.99),
                    Color(red: 0.92, green: 0.94, blue: 0.97),
                    Color(red: 0.89, green: 0.92, blue: 0.96)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            
            VStack(spacing: 32) {
                VStack(spacing: 8) {
                    Text("Memory Shelf")
                        .font(.custom("SF Pro Display", size: 42))
                        .fontWeight(.bold)
                        .foregroundStyle(
                            LinearGradient(
                                colors: [Color.primary, Color.primary.opacity(0.8)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                    
                    Text("Your personal collection of memories and moments")
                        .font(.custom("SF Pro Text", size: 16))
                        .fontWeight(.medium)
                        .foregroundColor(.secondary)
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
                            .onHover { hovering in
                                withAnimation(.easeInOut(duration: 0.2)) {
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
            } else if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, error in
                    if let data = item as? Data, let url = URL(dataRepresentation: data, relativeTo: nil) {
                        DispatchQueue.main.async {
                            let slotItem = SlotItem(
                                title: url.lastPathComponent,
                                type: .file,
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
    
    func copyToPasteboard(_ item: SlotItem) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        
        switch item.type {
        case .text:
            if let text = String(data: item.data, encoding: .utf8) {
                pasteboard.setString(text, forType: .string)
            }
        case .image:
            pasteboard.setData(item.data, forType: .png)
        case .file, .url:
            if let url = URL(dataRepresentation: item.data, relativeTo: nil) {
                pasteboard.setString(url.absoluteString, forType: .string)
            }
        }
    }
}