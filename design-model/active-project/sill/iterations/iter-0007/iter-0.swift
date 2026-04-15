struct ContentView: View {
    @StateObject private var store: ShelfStore = ShelfStore()
    @State private var hoveredSlot: Int? = nil
    @State private var hasLaunched: Bool = false
    
    private let maxSlots: Int = 8
    private let slotWidth: CGFloat = 140
    private let slotHeight: CGFloat = 100
    private let slotSpacing: CGFloat = 12
    
    private let oakGrain = Color(red: 0.96, green: 0.91, blue: 0.83)
    private let warmShadow = Color(red: 0.55, green: 0.41, blue: 0.08).opacity(0.08)
    private let creamHighlight = Color(red: 1.0, green: 0.97, blue: 0.91)
    private let amberGlow = Color(red: 1.0, green: 0.7, blue: 0.28)
    
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
        .background(oakGrain)
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
            // Recessed wooden cradle background
            RoundedRectangle(cornerRadius: 8)
                .fill(
                    LinearGradient(
                        colors: [warmShadow, Color.clear],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(warmShadow, lineWidth: 1)
                        .blur(radius: 0.5)
                )
            
            if let item = item {
                itemContentView(item: item)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            } else {
                emptySlotView()
            }
        }
        .frame(width: slotWidth, height: slotHeight)
        .scaleEffect(isHovered ? 1.05 : 1.0)
        .animation(.interpolatingSpring(stiffness: 280, damping: 22), value: isHovered)
        .onHover { hovering in
            hoveredSlot = hovering ? index : nil
        }
        .onDrop(of: ["public.text", "public.url", "public.file-url"], isTargeted: nil) { providers in
            handleDrop(providers: providers, at: index)
        }
    }
    
    @ViewBuilder
    private func itemContentView(item: ShelfItem) -> some View {
        let ageInDays = Date().timeIntervalSince(item.createdAt) / 86400
        let glowOpacity = max(0.3, 1.0 - (ageInDays / 7.0))
        
        ZStack {
            // Age-based amber glow
            if ageInDays < 7 {
                RadialGradient(
                    colors: [amberGlow.opacity(glowOpacity * 0.6), Color.clear],
                    center: .center,
                    startRadius: 0,
                    endRadius: slotWidth * 0.7
                )
            }
            
            // Content preview
            VStack(spacing: 4) {
                Spacer()
                
                Text(contentPreview(for: item))
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundColor(.black.opacity(0.8))
                    .lineLimit(3)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 8)
                
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
            .padding(6)
        }
        .background(creamHighlight.opacity(0.4))
        .draggable(item.content)
        .contextMenu {
            Button("Remove") {
                store.removeItem(at: store.items.firstIndex { $0?.id == item.id } ?? 0)
            }
        }
    }
    
    @ViewBuilder
    private func emptySlotView() -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .stroke(warmShadow, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                .opacity(0.5)
            
            Image(systemName: "plus")
                .font(.system(size: 16, weight: .light))
                .foregroundColor(warmShadow)
                .scaleEffect(hasLaunched ? 1.0 : 1.2)
                .animation(.easeOut(duration: 0.8), value: hasLaunched)
        }
    }
    
    @ViewBuilder
    private func typeBadge(for type: ShelfItem.ItemType) -> some View {
        Text(type.displayName)
            .font(.system(size: 8, weight: .semibold, design: .rounded))
            .foregroundColor(.white)
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
            .background(type.chipColor)
            .clipShape(RoundedRectangle(cornerRadius: 3))
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
                            type: url.pathExtension.lowercased() == "jpg" || url.pathExtension.lowercased() == "png" ? .image : .url,
                            createdAt: Date()
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
                            type: .text,
                            createdAt: Date()
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