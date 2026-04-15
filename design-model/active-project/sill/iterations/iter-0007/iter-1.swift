struct ContentView: View {
    @StateObject private var store: ShelfStore = ShelfStore()
    @State private var hoveredSlot: Int? = nil
    @State private var hasLaunched: Bool = false
    
    private let maxSlots: Int = 8
    private let slotWidth: CGFloat = 140
    private let slotHeight: CGFloat = 100
    private let slotSpacing: CGFloat = 12
    
    var body: some View {
        VStack(spacing: 0) {
            // Main shelf panel
            HStack(spacing: slotSpacing) {
                ForEach(0..<maxSlots, id: \.self) { index in
                    slotView(for: index)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .frame(width: CGFloat(maxSlots) * (slotWidth + slotSpacing) + 40 - slotSpacing)
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                hasLaunched = true
            }
        }
    }
    
    @ViewBuilder
    private func slotView(for index: Int) -> some View {
        let item = store.items[index]
        let isHovered = hoveredSlot == index
        
        ZStack {
            // Clean material background
            RoundedRectangle(cornerRadius: 8)
                .fill(.thickMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(.separator.opacity(0.3), lineWidth: 1)
                )
            
            if let item = item {
                itemContentView(item: item)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            } else {
                emptySlotView()
            }
        }
        .frame(width: slotWidth, height: slotHeight)
        .scaleEffect(isHovered ? 1.02 : 1.0)
        .animation(.easeInOut(duration: 0.15), value: isHovered)
        .onHover { hovering in
            hoveredSlot = hovering ? index : nil
        }
        .onDrop(of: ["public.text", "public.url", "public.file-url"], isTargeted: nil) { providers in
            handleDrop(providers: providers, at: index)
        }
    }
    
    @ViewBuilder
    private func itemContentView(item: ShelfItem) -> some View {
        ZStack {
            // Content preview
            VStack(spacing: 6) {
                Spacer()
                
                Text(contentPreview(for: item))
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(.primary)
                    .lineLimit(3)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 10)
                
                Spacer()
            }
            
            // Type badge in bottom-left
            VStack {
                Spacer()
                HStack {
                    typeBadge(for: item.type)
                    Spacer()
                }
            }
            .padding(8)
        }
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 8))
        .draggable(item.content)
        .contextMenu {
            Button("Remove", role: .destructive) {
                store.removeItem(at: store.items.firstIndex { $0?.id == item.id } ?? 0)
            }
        }
    }
    
    @ViewBuilder
    private func emptySlotView() -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(.separator, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                .opacity(0.5)
            
            Image(systemName: "plus")
                .font(.system(size: 16, weight: .regular))
                .foregroundStyle(.secondary)
                .scaleEffect(hasLaunched ? 1.0 : 1.2)
                .animation(.easeOut(duration: 0.8), value: hasLaunched)
        }
    }
    
    @ViewBuilder
    private func typeBadge(for type: ShelfItem.ItemType) -> some View {
        Text(type.displayName)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(type.chipColor, in: RoundedRectangle(cornerRadius: 4))
    }
    
    private func contentPreview(for item: ShelfItem) -> String {
        let maxLength = 60
        return item.content.count > maxLength ? 
            String(item.content.prefix(maxLength)) + "..." : 
            item.content
    }
    
    private func handleDrop(providers: [NSItemProvider], at index: Int) -> Bool {
        guard let provider = providers.first else { return false }
        
        if provider.hasItemConformingToTypeIdentifier("public.url") {
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                if let url = url {
                    DispatchQueue.main.async {
                        let item = ShelfItem(
                            content: url.absoluteString,
                            type: .url
                        )
                        store.addItem(item, at: index)
                    }
                }
            }
            return true
        } else if provider.hasItemConformingToTypeIdentifier("public.text") {
            _ = provider.loadObject(ofClass: String.self) { text, _ in
                if let text = text {
                    DispatchQueue.main.async {
                        let item = ShelfItem(
                            content: text,
                            type: .text
                        )
                        store.addItem(item, at: index)
                    }
                }
            }
            return true
        }
        
        return false
    }
}