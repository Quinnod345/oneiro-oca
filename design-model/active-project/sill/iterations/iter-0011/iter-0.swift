struct ContentView: View {
    @StateObject private var store: ShelfStore = ShelfStore()
    @StateObject private var dragController: DragController = DragController()
    
    var body: some View {
        ZStack {
            Color(red: 0.95, green: 0.92, blue: 0.88).ignoresSafeArea()
            
            VStack(spacing: 0) {
                HStack {
                    Text("Sill")
                        .font(.system(size: 28, weight: .light, design: .serif))
                        .foregroundColor(Color(red: 0.4, green: 0.3, blue: 0.2))
                    
                    Spacer()
                }
                .padding(.horizontal, 32)
                .padding(.top, 24)
                
                Spacer().frame(height: 40)
                
                HStack(spacing: 12) {
                    ForEach(0..<8, id: \.self) { index in
                        let item = index < store.items.count ? store.items[index] : nil
                        
                        DraggableShelfSlot(item: item, dragController: dragController)
                            .frame(width: 80, height: 80)
                    }
                }
                .padding(.horizontal, 32)
                
                Spacer()
                
                VStack(spacing: 8) {
                    Text("Drop items here to save them")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
                    
                    Text("Drag items out to use them elsewhere")
                        .font(.system(size: 12, weight: .regular))
                        .foregroundColor(Color(red: 0.6, green: 0.5, blue: 0.4))
                }
                .padding(.bottom, 32)
            }
        }
        .frame(width: 1440, height: 900)
        .onDrop(of: [.fileURL, .text, .image, .url], isTargeted: nil) { providers in
            handleDrop(providers: providers)
            return true
        }
    }
    
    private func handleDrop(providers: [NSItemProvider]) -> Void {
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier("public.file-url") {
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    if let url = url {
                        let item = ShelfItem(
                            type: .fileURL,
                            data: url.absoluteString.data(using: .utf8) ?? Data(),
                            displayName: url.lastPathComponent
                        )
                        DispatchQueue.main.async {
                            store.addItem(item)
                        }
                    }
                }
            } else if provider.hasItemConformingToTypeIdentifier("public.text") {
                _ = provider.loadObject(ofClass: String.self) { text, _ in
                    if let text = text {
                        let item = ShelfItem(
                            type: .text,
                            data: text.data(using: .utf8) ?? Data(),
                            displayName: String(text.prefix(20))
                        )
                        DispatchQueue.main.async {
                            store.addItem(item)
                        }
                    }
                }
            } else if provider.hasItemConformingToTypeIdentifier("public.image") {
                _ = provider.loadObject(ofClass: NSImage.self) { image, _ in
                    if let image = image, let data = image.tiffRepresentation {
                        let item = ShelfItem(
                            type: .image,
                            data: data,
                            displayName: "Image"
                        )
                        DispatchQueue.main.async {
                            store.addItem(item)
                        }
                    }
                }
            } else if provider.hasItemConformingToTypeIdentifier("public.url") {
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    if let url = url {
                        let item = ShelfItem(
                            type: .webURL,
                            data: url.absoluteString.data(using: .utf8) ?? Data(),
                            displayName: url.host ?? "Web Link"
                        )
                        DispatchQueue.main.async {
                            store.addItem(item)
                        }
                    }
                }
            }
        }
    }
}