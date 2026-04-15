struct ContentView: View {
    @State private var shelfItems: [ShelfItem] = [
        ShelfItem(title: "Project Alpha", lastUsed: Date().addingTimeInterval(-3600)),
        ShelfItem(title: "Design System", lastUsed: Date().addingTimeInterval(-86400 * 1.5)),
        ShelfItem(title: "API Documentation", lastUsed: Date().addingTimeInterval(-86400 * 3)),
        ShelfItem(title: "Team Notes", lastUsed: Date().addingTimeInterval(-86400 * 5.5)),
        ShelfItem(title: "Archive", lastUsed: Date().addingTimeInterval(-86400 * 6.8))
    ]
    
    @State private var hoveredSlot: Int? = nil
    @State private var selectedSlot: Int? = nil
    
    var body: some View {
        ZStack {
            // System background with vibrancy
            Color.clear
                .background(.regularMaterial, in: Rectangle())
            
            HStack(spacing: 20) {
                ForEach(0..<8, id: \.self) { index in
                    ShelfSlotView(
                        item: index < shelfItems.count ? shelfItems[index] : nil,
                        isHovered: hoveredSlot == index,
                        isSelected: selectedSlot == index
                    )
                    .onHover { isHovering in
                        withAnimation(.easeInOut(duration: 0.15)) {
                            hoveredSlot = isHovering ? index : nil
                        }
                    }
                    .onTapGesture {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            selectedSlot = selectedSlot == index ? nil : index
                        }
                    }
                }
            }
            .padding(.horizontal, 40)
        }
        .frame(width: 1440, height: 900)
    }
}

struct ShelfSlotView: View {
    let item: ShelfItem?
    let isHovered: Bool
    let isSelected: Bool
    
    private var ageInDays: Double {
        guard let item = item else { return 0 }
        return Date().timeIntervalSince(item.lastUsed) / 86400
    }
    
    private var freshnessColor: Color {
        guard item != nil else { return .secondary.opacity(0.3) }
        
        if ageInDays <= 1 {
            return .green
        } else if ageInDays <= 3 {
            return .orange
        } else {
            return .secondary
        }
    }
    
    private var itemOpacity: Double {
        guard item != nil else { return 0.4 }
        if ageInDays <= 1 { return 1.0 }
        if ageInDays <= 3 { return 0.8 }
        return 0.6
    }
    
    var body: some View {
        VStack(spacing: 16) {
            ZStack {
                // Base card with material background
                RoundedRectangle(cornerRadius: 12)
                    .fill(.ultraThinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(.quaternary, lineWidth: 0.5)
                    )
                
                // Selection state
                if isSelected {
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(.blue, lineWidth: 2)
                }
                
                // Hover state
                if isHovered {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.primary.opacity(0.05))
                }
                
                // Content
                VStack(spacing: 12) {
                    // Freshness indicator
                    Circle()
                        .fill(freshnessColor)
                        .frame(width: 8, height: 8)
                        .opacity(item != nil ? itemOpacity : 0)
                    
                    // Document icon placeholder
                    RoundedRectangle(cornerRadius: 8)
                        .fill(.secondary.opacity(item != nil ? 0.3 : 0.1))
                        .frame(width: 60, height: 80)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(.tertiary, lineWidth: 0.5)
                        )
                }
                .opacity(itemOpacity)
            }
            .frame(width: 120, height: 140)
            
            // Title with SF Pro Display
            Text(item?.title ?? "Empty")
                .font(.custom("SF Pro Display", size: 14, relativeTo: .caption))
                .fontWeight(item != nil ? .medium : .regular)
                .foregroundColor(item != nil ? .primary : .secondary)
                .opacity(itemOpacity)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(width: 120)
        }
        .scaleEffect(isHovered ? 1.05 : 1.0)
        .animation(.easeInOut(duration: 0.2), value: isHovered)
        .animation(.easeInOut(duration: 0.15), value: isSelected)
    }
}