struct ContentView: View {
    @StateObject private var store: ShelfStore = ShelfStore()
    @State private var hoveredSlot: Int? = nil
    @State private var hasLaunched: Bool = false
    @State private var draggedItem: ShelfItem? = nil
    @State private var pulsePhase: Double = 0
    
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
            withAnimation(.easeOut(duration: 0.8)) {
                hasLaunched = true
            }
            startContinuousAnimation()
        }
    }
    
    @ViewBuilder
    private func slotView(for index: Int) -> some View {
        let item = store.items[index]
        let isHovered = hoveredSlot == index
        let isDragTarget = draggedItem != nil && item == nil
        
        ZStack {
            // Enhanced material background with depth
            RoundedRectangle(cornerRadius: 12)
                .fill(.thickMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(
                            isDragTarget ? 
                                .accent.opacity(0.6) : 
                                .separator.opacity(isHovered ? 0.5 : 0.2), 
                            lineWidth: isDragTarget ? 2 : 1
                        )
                )
                .shadow(
                    color: isHovered ? .black.opacity(0.1) : .clear,
                    radius: isHovered ? 8 : 0,
                    y: isHovered ? 4 : 0
                )
            
            if let item = item {
                itemContentView(item: item, isHovered: isHovered)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                emptySlotView(isHovered: isHovered, isDragTarget: isDragTarget)
            }
        }
        .frame(width: slotWidth, height: slotHeight)
        .scaleEffect(isHovered ? 1.05 : (isDragTarget ? 1.02 : 1.0))
        .animation(
            .spring(response: 0.5, dampingFraction: 0.7, blendDuration: 0),
            value: isHovered
        )
        .animation(
            .spring(response: 0.4, dampingFraction: 0.8, blendDuration: 0),
            value: isDragTarget
        )
        .onHover { hovering in
            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                hoveredSlot = hovering ? index : nil
            }
        }
        .onDrop(of: ["public.text", "public.url", "public.file-url"], isTargeted: nil) { providers in
            handleDrop(providers: providers, at: index)
        }
    }
    
    @ViewBuilder
    private func itemContentView(item: ShelfItem, isHovered: Bool) -> some View {
        ZStack {
            // Enhanced gradient background
            LinearGradient(
                colors: [
                    item.type.backgroundColor.opacity(0.1),
                    item.type.backgroundColor.opacity(0.05)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            
            // Content with improved hierarchy
            VStack(spacing: 8) {
                Spacer()
                
                // Primary content
                Text(contentPreview(for: item))
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(.primary)
                    .lineLimit(isHovered ? 4 : 3)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 12)
                    .opacity(isHovered ? 1.0 : 0.9)
                
                Spacer()
                
                // Secondary info
                if isHovered {
                    Text("\(item.content.count) characters")
                        .font(.system(size: 10, weight: .regular))
                        .foregroundStyle(.secondary)
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
            }
            .animation(.easeInOut(duration: 0.2), value: isHovered)
            
            // Enhanced type badge
            VStack {
                Spacer()
                HStack {
                    enhancedTypeBadge(for: item.type, isHovered: isHovered)
                    Spacer()
                }
            }
            .padding(10)
        }
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .draggable(item.content) {
            draggedItem = item
        }
        .contextMenu {
            Button("Copy Content") {
                NSPasteboard.general.setString(item.content, forType: .string)
            }
            Button("Edit Content") {
                // Future implementation
            }
            Divider()
            Button("Remove", role: .destructive) {
                withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                    store.removeItem(at: store.items.firstIndex { $0?.id == item.id } ?? 0)
                }
            }
        }
    }
    
    @ViewBuilder
    private func emptySlotView(isHovered: Bool, isDragTarget: Bool) -> some View {
        ZStack {
            // Enhanced empty state background
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(
                    isDragTarget ? 
                        .accent : .separator.opacity(0.3),
                    style: StrokeStyle(
                        lineWidth: isDragTarget ? 2 : 1,
                        dash: isDragTarget ? [] : [6, 6]
                    )
                )
                .opacity(isDragTarget ? 1.0 : 0.6)
            
            VStack(spacing: 6) {
                // Animated plus icon with subtle pulsing
                Image(systemName: isDragTarget ? "arrow.down.circle.fill" : "plus.circle")
                    .font(.system(size: isDragTarget ? 24 : 18, weight: .medium))
                    .foregroundStyle(
                        isDragTarget ? 
                            .accent : 
                            .secondary.opacity(0.7 + 0.3 * sin(pulsePhase))
                    )
                    .scaleEffect(
                        isDragTarget ? 1.1 : 
                        (hasLaunched ? (isHovered ? 1.1 : 1.0) : 1.3)
                    )
                
                // Improved empty state messaging
                Text(isDragTarget ? "Drop here" : (isHovered ? "Drop content" : "Empty"))
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(
                        isDragTarget ? 
                            .accent : 
                            .secondary.opacity(isHovered ? 0.8 : 0.5)
                    )
                    .transition(.opacity.combined(with: .scale))
            }
        }
        .animation(
            .spring(response: 0.6, dampingFraction: 0.7),
            value: hasLaunched
        )
        .animation(
            .spring(response: 0.4, dampingFraction: 0.8),
            value: isDragTarget
        )
    }
    
    @ViewBuilder
    private func enhancedTypeBadge(for type: ShelfItem.ItemType, isHovered: Bool) -> some View {
        HStack(spacing: 4) {
            Image(systemName: type.iconName)
                .font(.system(size: 9, weight: .semibold))
            
            Text(type.displayName)
                .font(.system(size: 10, weight: .semibold, design: .rounded))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            ZStack {
                // Base color
                type.chipColor
                
                // Subtle gradient overlay
                LinearGradient(
                    colors: [
                        .white.opacity(0.2),
                        .clear,
                        .black.opacity(0.1)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            },
            in: RoundedRectangle(cornerRadius: 6)
        )
        .shadow(color: type.chipColor.opacity(0.3), radius: isHovered ? 3 : 1, y: 1)
        .scaleEffect(isHovered ? 1.05 : 1.0)
        .animation(.easeInOut(duration: 0.15), value: isHovered)
    }
    
    private func contentPreview(for item: ShelfItem) -> String {
        let maxLength = 60
        let cleaned = item.content.trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.count > maxLength ? 
            String(cleaned.prefix(maxLength)) + "…" : 
            cleaned
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
                        withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                            store.addItem(item, at: index)
                        }
                        draggedItem = nil
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
                        withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                            store.addItem(item, at: index)
                        }
                        draggedItem = nil
                    }
                }
            }
            return true
        }
        
        return false
    }
    
    private func startContinuousAnimation() {
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            pulsePhase += 0.1
        }
    }
}

extension ShelfItem.ItemType {
    var iconName: String {
        switch self {
        case .text: return "doc.text"
        case .url: return "link"
        }
    }
    
    var backgroundColor: Color {
        switch self {
        case .text: return .blue
        case .url: return .green
        }
    }
}