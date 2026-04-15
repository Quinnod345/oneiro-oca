struct ShelfItem: Identifiable {
    let id = UUID()
    let type: ItemType
    let data: Data
    let displayName: String
    
    enum ItemType {
        case fileURL
        case text
        case image
        case url
    }
}

class ShelfStore: ObservableObject {
    @Published var items: [ShelfItem] = []
    
    func addItem(_ item: ShelfItem) {
        if items.count < 8 {
            items.append(item)
        }
    }
    
    func removeItem(at index: Int) {
        guard index < items.count else { return }
        items.remove(at: index)
    }
}

class DragController: ObservableObject {
    @Published var isDragging = false
    @Published var draggedItem: ShelfItem?
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
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}

struct DraggableShelfSlot: View {
    let item: ShelfItem?
    let dragController: DragController
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.gray.opacity(0.1))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(Color.gray.opacity(0.2), lineWidth: 1)
                )
            
            if let item = item {
                VStack {
                    Image(systemName: iconForType(item.type))
                        .font(.system(size: 28))
                        .foregroundColor(.blue)
                    
                    Text(item.displayName)
                        .font(.caption)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .foregroundColor(.primary)
                }
                .padding(8)
            }
        }
    }
    
    private func iconForType(_ type: ShelfItem.ItemType) -> String {
        switch type {
        case .fileURL:
            return "doc.fill"
        case .text:
            return "text.alignleft"
        case .image:
            return "photo.fill"
        case .url:
            return "link"
        }
    }
}

struct ContentView: View {
    @StateObject private var store = ShelfStore()
    @StateObject private var dragController = DragController()
    @State private var isDragTargeted: Bool = false
    @State private var hoveredSlotIndex: Int? = nil
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                VisualEffectView(material: .underWindowBackground, blendingMode: .behindWindow)
                    .ignoresSafeArea()
                
                VStack(spacing: 40) {
                    HStack {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Sill")
                                .font(.system(size: 34, weight: .medium, design: .default))
                                .foregroundColor(.primary)
                            
                            Text("Digital Shelf")
                                .font(.headline)
                                .foregroundColor(.secondary)
                        }
                        
                        Spacer()
                        
                        if !store.items.isEmpty {
                            Text("\(store.items.count)/8")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(Color.gray.opacity(0.15), in: Capsule())
                        }
                    }
                    .padding(.horizontal, 32)
                    .padding(.top, 24)
                    
                    VStack(spacing: 24) {
                        HStack(spacing: 28) {
                            ForEach(0..<8, id: \.self) { index in
                                let item = index < store.items.count ? store.items[index] : nil
                                
                                DraggableShelfSlot(item: item, dragController: dragController)
                                    .frame(width: slotSize(for: geometry), height: slotSize(for: geometry))
                                    .scaleEffect(getSlotScale(for: index))
                                    .shadow(color: Color.blue.opacity(0.3), radius: hoveredSlotIndex == index ? 12 : 0)
                                    .animation(.spring(response: 0.4, dampingFraction: 0.7), value: hoveredSlotIndex)
                                    .onHover { hovering in
                                        hoveredSlotIndex = hovering ? index : nil
                                    }
                            }
                        }
                        .padding(.horizontal, 32)
                        
                        if store.items.isEmpty || isDragTargeted {
                            VStack(spacing: 16) {
                                ZStack {
                                    Circle()
                                        .fill(Color.gray.opacity(0.1))
                                        .frame(width: 56, height: 56)
                                        .scaleEffect(isDragTargeted ? 1.1 : 1.0)
                                    
                                    Image(systemName: isDragTargeted ? "plus.circle.fill" : "arrow.down.circle")
                                        .font(.title)
                                        .foregroundColor(isDragTargeted ? .blue : .secondary)
                                }
                                
                                VStack(spacing: 8) {
                                    Text(store.items.isEmpty ? "Drop items here to start your collection" : "Release to add to shelf")
                                        .font(.body)
                                        .fontWeight(.medium)
                                        .foregroundColor(.primary)
                                    
                                    if store.items.isEmpty {
                                        Text("Text, files, images, and links • Drag items out to use them")
                                            .font(.subheadline)
                                            .foregroundColor(.secondary)
                                            .multilineTextAlignment(.center)
                                    }
                                }
                            }
                            .padding(.bottom, 24)
                            .animation(.spring(response: 0.5, dampingFraction: 0.8), value: isDragTargeted)
                            .animation(.easeInOut(duration: 0.3), value: store.items.isEmpty)
                        }
                    }
                }
            }
        }
        .onDrop(of: [.fileURL, .text, .image, .url], isTargeted: $isDragTargeted) { providers in
            handleDrop(providers: providers)
            return true
        }
    }
    
    private func getSlotScale(for index: Int) -> CGFloat {
        if isDragTargeted && index >= store.items.count {
            return 1.05
        }
        return 1.0
    }
    
    private func slotSize(for geometry: GeometryProxy) -> CGFloat {
        let availableWidth = geometry.size.width - 64 - (7 * 28)
        let calculatedSize = availableWidth / 8
        return min(max(calculatedSize, 70), 110)
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
            }
        }
    }
}