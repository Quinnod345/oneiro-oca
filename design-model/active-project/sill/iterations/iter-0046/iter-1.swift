struct ShelfItem: Identifiable {
    let id = UUID()
    let content: String
    let type: ItemType
    let warmthTint: Color
    let saturation: Double
    let opacity: Double
    let decayProgress: Double
    
    enum ItemType {
        case text
        case url
        case image
        case file
    }
}

struct ContentView: View {
    @State private var items: [ShelfItem] = []
    @State private var dragOver: Bool = false
    @State private var hoveredSlot: Int? = nil
    
    let maxSlots: Int = 8
    let slotSize: CGSize = CGSize(width: 140, height: 100)
    let shelfPadding: Double = 24
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Native material background
                Rectangle()
                    .fill(.regularMaterial)
                    .ignoresSafeArea()
                
                // Main shelf content
                HStack(spacing: 16) {
                    ForEach(0..<maxSlots, id: \.self) { index in
                        ZStack {
                            // Slot background with native styling
                            RoundedRectangle(cornerRadius: 12)
                                .fill(.quaternary)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(.separator, lineWidth: 0.5)
                                )
                                .shadow(radius: items.count > index ? 2 : 0)
                            
                            if items.count > index {
                                let item = items[index]
                                
                                VStack(spacing: 8) {
                                    // Item type indicator
                                    Image(systemName: iconForType(item.type))
                                        .font(.system(size: 20, weight: .medium))
                                        .foregroundColor(.primary)
                                    
                                    // Content preview
                                    Text(item.content)
                                        .font(.system(size: 13, weight: .regular, design: .default))
                                        .foregroundColor(.secondary)
                                        .lineLimit(3)
                                        .multilineTextAlignment(.center)
                                        .padding(.horizontal, 8)
                                }
                            }
                        }
                        .frame(width: slotSize.width, height: slotSize.height)
                        .scaleEffect(hoveredSlot == index ? 1.05 : 1.0)
                        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: hoveredSlot)
                        .onHover { isHovering in
                            hoveredSlot = isHovering ? index : nil
                        }
                        .onDrop(of: ["public.text", "public.url"], isTargeted: nil) { providers in
                            handleDrop(providers: providers, at: index)
                        }
                    }
                }
                .padding(.horizontal, shelfPadding)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            addSampleItems()
        }
    }
    
    private func iconForType(_ type: ShelfItem.ItemType) -> String {
        switch type {
        case .text: return "doc.text"
        case .url: return "link"
        case .image: return "photo"
        case .file: return "doc"
        }
    }
    
    private func handleDrop(providers: [NSItemProvider], at index: Int) -> Bool {
        for provider in providers {
            if provider.canLoadObject(ofClass: String.self) {
                provider.loadObject(ofClass: String.self) { string, error in
                    if let content = string {
                        DispatchQueue.main.async {
                            let newItem = ShelfItem(
                                content: content,
                                type: content.contains("http") ? .url : .text,
                                warmthTint: Color.clear,
                                saturation: 1.0,
                                opacity: 1.0,
                                decayProgress: 0.0
                            )
                            if index < items.count {
                                items[index] = newItem
                            } else {
                                items.append(newItem)
                            }
                        }
                    }
                }
                return true
            }
        }
        return false
    }
    
    private func addSampleItems() {
        items = [
            ShelfItem(content: "Sample document", type: .text, warmthTint: Color.clear, saturation: 1.0, opacity: 1.0, decayProgress: 0.0),
            ShelfItem(content: "https://example.com", type: .url, warmthTint: Color.clear, saturation: 1.0, opacity: 1.0, decayProgress: 0.0)
        ]
    }
}