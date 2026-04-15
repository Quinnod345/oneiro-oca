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
            
            HStack(spacing: 12) {
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
    
    private var itemOpacity: Double {
        guard item != nil else { return 0.6 }
        if ageInDays <= 1 { return 1.0 }
        if ageInDays <= 3 { return 0.8 }
        return 0.6
    }
    
    private var sfSymbol: String {
        guard let item = item else { return "plus" }
        if item.title.contains("Project") { return "folder.fill" }
        if item.title.contains("Design") { return "paintbrush.fill" }
        if item.title.contains("API") { return "doc.text.fill" }
        if item.title.contains("Notes") { return "note.text" }
        if item.title.contains("Archive") { return "archivebox.fill" }
        return "doc.fill"
    }
    
    var body: some View {
        Group {
            if item != nil {
                VStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(.ultraThinMaterial)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(.quaternary, lineWidth: 0.5)
                            )
                        
                        Image(systemName: sfSymbol)
                            .font(.system(size: 32, weight: .medium))
                            .foregroundColor(.primary)
                        
                        if isFocused {
                            RoundedRectangle(cornerRadius: 12)
                                .strokeBorder(.tint, lineWidth: 4)
                                .blendMode(.plusLighter)
                        }
                        
                        if isSelected {
                            RoundedRectangle(cornerRadius: 12)
                                .strokeBorder(.blue, lineWidth: 2)
                        }
                    }
                    .frame(width: 120, height: 120)
                    .scaleEffect(isHovered ? 1.05 : 1.0)
                    .opacity(itemOpacity)
                    
                    Text(item?.title ?? "")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.primary)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                        .frame(width: 120)
                        .opacity(itemOpacity)
                }
            } else {
                VStack {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(.ultraThinMaterial)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(.quaternary, lineWidth: 0.5)
                            )
                        
                        Image(systemName: "plus")
                            .font(.system(size: 24, weight: .medium))
                            .foregroundColor(.secondary)
                        
                        if isFocused {
                            RoundedRectangle(cornerRadius: 12)
                                .strokeBorder(.tint, lineWidth: 4)
                                .blendMode(.plusLighter)
                        }
                    }
                    .frame(width: 120, height: 120)
                    .scaleEffect(isHovered ? 1.05 : 1.0)
                    .opacity(0.6)
                    
                    Text("")
                        .frame(height: 32)
                }
            }
        }
        .animation(.easeInOut(duration: 0.15), value: isHovered)
        .animation(.easeInOut(duration: 0.2), value: isSelected)
        .animation(.easeInOut(duration: 0.15), value: isFocused)
    }
}