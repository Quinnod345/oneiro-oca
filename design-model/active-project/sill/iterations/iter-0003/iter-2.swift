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
    @State private var focusedSlot: Int? = nil
    
    var body: some View {
        ZStack {
            Color.clear
                .background(.regularMaterial, in: Rectangle())
            
            HStack(spacing: 0) {
                ForEach(0..<8, id: \.self) { index in
                    ShelfSlotView(
                        item: index < shelfItems.count ? shelfItems[index] : nil,
                        isHovered: hoveredSlot == index,
                        isSelected: selectedSlot == index,
                        isFocused: focusedSlot == index
                    )
                    .onHover { isHovering in
                        withAnimation(.easeInOut(duration: 0.15)) {
                            hoveredSlot = isHovering ? index : nil
                        }
                    }
                    .onTapGesture {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            selectedSlot = selectedSlot == index ? nil : index
                            focusedSlot = index
                        }
                    }
                    .contextMenu {
                        if index < shelfItems.count {
                            Button("Open") {
                                selectedSlot = index
                            }
                            Button("Remove from Shelf") {
                                shelfItems.remove(at: index)
                            }
                            Divider()
                            Button("Show in Finder") { }
                        } else {
                            Button("Add Item") { }
                        }
                    }
                }
            }
            .padding(.horizontal, 40)
            .focusable()
            .onKeyPress { keyPress in
                handleKeyPress(keyPress)
                return .handled
            }
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            focusedSlot = 0
        }
    }
    
    private func handleKeyPress(_ keyPress: KeyPress) -> KeyPress.Result {
        let currentFocus = focusedSlot ?? 0
        
        switch keyPress.key {
        case .leftArrow:
            withAnimation(.easeInOut(duration: 0.15)) {
                focusedSlot = max(0, currentFocus - 1)
            }
        case .rightArrow:
            withAnimation(.easeInOut(duration: 0.15)) {
                focusedSlot = min(7, currentFocus + 1)
            }
        case .return:
            withAnimation(.easeInOut(duration: 0.2)) {
                selectedSlot = selectedSlot == currentFocus ? nil : currentFocus
            }
        default:
            return .ignored
        }
        return .handled
    }
}

struct ShelfSlotView: View {
    let item: ShelfItem?
    let isHovered: Bool
    let isSelected: Bool
    let isFocused: Bool
    
    private var ageInDays: Double {
        guard let item = item else { return 0 }
        return Date().timeIntervalSince(item.lastUsed) / 86400
    }
    
    private var freshnessGradient: LinearGradient {
        guard item != nil else { 
            return LinearGradient(
                colors: [.secondary.opacity(0.1)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
        
        let accentColor: Color
        let neutralColor: Color = .secondary.opacity(0.2)
        
        if ageInDays <= 1 {
            accentColor = .green.opacity(0.6)
        } else if ageInDays <= 3 {
            accentColor = .orange.opacity(0.5)
        } else {
            accentColor = .secondary.opacity(0.3)
        }
        
        return LinearGradient(
            colors: [accentColor, neutralColor],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
    
    private var itemOpacity: Double {
        guard item != nil else { return 0.4 }
        if ageInDays <= 1 { return 1.0 }
        if ageInDays <= 3 { return 0.8 }
        return 0.6
    }
    
    private var slotWidth: CGFloat {
        if item != nil {
            if ageInDays <= 1 { return 140 }
            if ageInDays <= 3 { return 120 }
            return 100
        } else {
            return 20
        }
    }
    
    private var slotHeight: CGFloat {
        if item != nil {
            if ageInDays <= 1 { return 160 }
            if ageInDays <= 3 { return 140 }
            return 120
        } else {
            return 100
        }
    }
    
    var body: some View {
        Group {
            if item != nil {
                VStack(spacing: 16) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(.ultraThinMaterial)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(freshnessGradient)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(.quaternary, lineWidth: 0.5)
                            )
                        
                        if isSelected {
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(.blue, lineWidth: 2)
                        }
                        
                        if isFocused {
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(.blue.opacity(0.5), lineWidth: 1)
                        }
                        
                        if isHovered {
                            RoundedRectangle(cornerRadius: 12)
                                .fill(.primary.opacity(0.05))
                        }
                        
                        VStack(spacing: 12) {
                            RoundedRectangle(cornerRadius: 8)
                                .fill(.secondary.opacity(0.3))
                                .frame(width: slotWidth * 0.5, height: slotHeight * 0.6)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(.tertiary, lineWidth: 0.5)
                                )
                        }
                        .opacity(itemOpacity)
                    }
                    .frame(width: slotWidth, height: slotHeight)
                    
                    Text(item?.title ?? "")
                        .font(.custom("SF Pro Display", size: ageInDays <= 1 ? 15 : 14, relativeTo: .caption))
                        .fontWeight(.medium)
                        .foregroundColor(.primary)
                        .opacity(itemOpacity)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .frame(width: slotWidth)
                }
                .scaleEffect(isHovered ? 1.05 : 1.0)
                .animation(.easeInOut(duration: 0.2), value: isHovered)
                .animation(.easeInOut(duration: 0.15), value: isSelected)
                .animation(.easeInOut(duration: 0.3), value: slotWidth)
            } else {
                Rectangle()
                    .fill(.secondary.opacity(0.2))
                    .frame(width: 2, height: 60)
                    .opacity(isHovered ? 0.5 : 0.3)
                    .animation(.easeInOut(duration: 0.2), value: isHovered)
            }
        }
    }
}