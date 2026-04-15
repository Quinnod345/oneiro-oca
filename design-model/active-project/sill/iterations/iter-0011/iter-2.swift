struct ContentView: View {
    @StateObject private var store = ShelfStore()
    @StateObject private var dragController = DragController()
    @State private var isDragTargeted = false
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                VisualEffectView(material: .underWindowBackground, blendingMode: .behindWindow)
                    .ignoresSafeArea()
                
                VStack(spacing: 32) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Sill")
                                .font(.system(.largeTitle, design: .default, weight: .medium))
                                .foregroundStyle(.primary)
                            
                            Text("Digital Shelf")
                                .font(.headline)
                                .foregroundStyle(.secondary)
                        }
                        
                        Spacer()
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 20)
                    
                    HStack(spacing: 16) {
                        ForEach(0..<8, id: \.self) { index in
                            let item = index < store.items.count ? store.items[index] : nil
                            
                            DraggableShelfSlot(item: item, dragController: dragController)
                                .frame(width: slotSize(for: geometry), height: slotSize(for: geometry))
                        }
                    }
                    .padding(.horizontal, 24)
                    .scaleEffect(isDragTargeted ? 1.05 : 1.0)
                    .animation(.spring(response: 0.4, dampingFraction: 0.8), value: isDragTargeted)
                    
                    VStack(spacing: 12) {
                        Image(systemName: "arrow.down.circle")
                            .font(.title2)
                            .foregroundStyle(.secondary)
                            .opacity(store.items.isEmpty ? 1.0 : 0.6)
                        
                        VStack(spacing: 6) {
                            Text("Drop items here to save them")
                                .font(.body)
                                .fontWeight(.medium)
                                .foregroundStyle(.primary)
                            
                            Text("Drag items out to use them elsewhere")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.bottom, 20)
                    .opacity(isDragTargeted ? 0.8 : 1.0)
                }
            }
        }
        .onDrop(of: [.fileURL, .text, .image, .url], isTargeted: $isDragTargeted) { providers in
            handleDrop(providers: providers)
            return true
        }
    }
    
    private func slotSize(for geometry: GeometryProxy) -> CGFloat {
        let availableWidth = geometry.size.width - 48 - (7 * 16)
        let calculatedSize = availableWidth / 8
        return min(max(calculatedSize, 60), 100)
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

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = blendingMode
        return view
    }
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}