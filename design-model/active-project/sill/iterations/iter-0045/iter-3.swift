struct ContentView: View {
    @State private var items: [ShelfItem] = []
    @State private var draggedItem: ShelfItem?
    @State private var dragOffset: CGSize = .zero
    @State private var hoveredSlot: Int? = nil
    @State private var showingDropZones: Bool = false
    @State private var draggedOverSlot: Int? = nil
    
    let maxItems: Int = 8
    let slotWidth: CGFloat = 120
    let slotHeight: CGFloat = 90
    let shelfHeight: CGFloat = 160
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color(NSColor.windowBackgroundColor)
                    .ignoresSafeArea()
                
                VStack(spacing: 0) {
                    Spacer()
                    
                    VStack(spacing: 12) {
                        Text("Library Shelf")
                            .font(.custom("SF Pro Display", size: 32).weight(.medium))
                            .foregroundColor(.primary)
                        
                        if items.isEmpty {
                            VStack(spacing: 8) {
                                Image(systemName: "tray")
                                    .font(.system(size: 24))
                                    .foregroundColor(.secondary.opacity(0.6))
                                
                                Text("Your shelf is empty")
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundColor(.secondary)
                                
                                Text("Click 'Add Items' to get started")
                                    .font(.system(size: 11))
                                    .foregroundColor(.secondary.opacity(0.8))
                            }
                            .padding(.bottom, 20)
                        } else {
                            Text("Drag items to reorganize your collection")
                                .font(.system(size: 12))
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.bottom, 32)
                    
                    ZStack {
                        VisualEffectView(material: .hudWindow, blendingMode: .behindWindow)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                        
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(Color(NSColor.separatorColor).opacity(0.3), lineWidth: 0.5)
                        
                        HStack(spacing: 12) {
                            ForEach(0..<maxItems, id: \.self) { slotIndex in
                                slotView(for: slotIndex)
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.vertical, 20)
                    }
                    .frame(height: shelfHeight)
                    .shadow(color: .black.opacity(0.1), radius: 12, x: 0, y: 4)
                    
                    Spacer().frame(height: 40)
                    
                    Button("Add Sample Items") {
                        addSampleItems()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    
                    Spacer()
                }
            }
        }
        .onDrop(of: ["public.text"], isTargeted: $showingDropZones) { providers in
            handleExternalDrop(providers: providers)
        }
    }
    
    private func slotView(for index: Int) -> some View {
        let item = itemForSlot(index)
        let isDropTarget = draggedOverSlot == index && draggedItem != nil
        let isEmpty = item == nil
        
        return ZStack {
            RoundedRectangle(cornerRadius: 10)
                .fill(
                    isEmpty ? 
                    Color(NSColor.controlBackgroundColor).opacity(0.4) :
                    Color(NSColor.controlBackgroundColor).opacity(0.8)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(
                            isDropTarget ? Color(NSColor.controlAccentColor) :
                            hoveredSlot == index ? Color(NSColor.separatorColor) :
                            Color(NSColor.separatorColor).opacity(0.3),
                            lineWidth: isDropTarget ? 2 : 0.5
                        )
                )
                .frame(width: slotWidth, height: slotHeight)
                .scaleEffect(isDropTarget ? 1.05 : hoveredSlot == index ? 1.02 : 1.0)
                .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isDropTarget)
                .animation(.easeOut(duration: 0.2), value: hoveredSlot)
            
            if let item = item, draggedItem?.id != item.id {
                itemView(item: item)
            } else if isEmpty && !isDropTarget {
                Image(systemName: "plus.circle.dashed")
                    .font(.system(size: 20))
                    .foregroundColor(.secondary.opacity(0.3))
            }
            
            if isDropTarget {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color(NSColor.controlAccentColor).opacity(0.1))
                    .frame(width: slotWidth - 8, height: slotHeight - 8)
                    .overlay(
                        Image(systemName: "arrow.down.circle.fill")
                            .font(.system(size: 16))
                            .foregroundColor(Color(NSColor.controlAccentColor))
                    )
            }
        }
        .onHover { isHovering in
            withAnimation(.easeOut(duration: 0.15)) {
                hoveredSlot = isHovering ? index : nil
            }
        }
        .onDrop(of: ["public.text"], isTargeted: nil) { providers in
            moveItemToSlot(targetSlot: index)
            return true
        }
    }
    
    private func itemView(item: ShelfItem) -> some View {
        VStack(spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(item.type.color.opacity(0.15))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(item.type.color.opacity(0.3), lineWidth: 1)
                    )
                    .frame(width: slotWidth - 16, height: 45)
                
                Image(systemName: item.type.icon)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundColor(item.type.color)
            }
            
            Text(item.title)
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.primary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(width: slotWidth - 16)
        }
        .scaleEffect(draggedItem?.id == item.id ? 1.1 : 1.0)
        .opacity(draggedItem?.id == item.id ? 0.8 : 1.0)
        .offset(draggedItem?.id == item.id ? dragOffset : .zero)
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: draggedItem?.id)
        .gesture(
            DragGesture(coordinateSpace: .global)
                .onChanged { value in
                    if draggedItem == nil {
                        draggedItem = item
                    }
                    dragOffset = value.translation
                    
                    let currentSlot = calculateSlotFromGlobalPosition(value.location)
                    draggedOverSlot = currentSlot
                }
                .onEnded { value in
                    let targetSlot = calculateSlotFromGlobalPosition(value.location)
                    
                    withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                        moveItemToSlot(targetSlot: targetSlot)
                        draggedItem = nil
                        dragOffset = .zero
                        draggedOverSlot = nil
                    }
                }
        )
    }
    
    private func itemForSlot(_ slot: Int) -> ShelfItem? {
        return items.first { item in
            let itemSlot = Int(item.targetPosition.x / (slotWidth + 12))
            return itemSlot == slot
        }
    }
    
    private func calculateSlotFromGlobalPosition(_ location: CGPoint) -> Int {
        let slotIndex = max(0, Int((location.x - 20) / (slotWidth + 12)))
        return min(maxItems - 1, slotIndex)
    }
    
    private func moveItemToSlot(targetSlot: Int) {
        guard let draggedItem = draggedItem,
              let itemIndex = items.firstIndex(of: draggedItem) else { return }
        
        let existingItem = itemForSlot(targetSlot)
        
        if let existingItem = existingItem,
           let existingIndex = items.firstIndex(of: existingItem) {
            let draggedSlot = Int(draggedItem.targetPosition.x / (slotWidth + 12))
            
            items[existingIndex].targetPosition.x = CGFloat(draggedSlot) * (slotWidth + 12)
        }
        
        items[itemIndex].targetPosition.x = CGFloat(targetSlot) * (slotWidth + 12)
    }
    
    private func addSampleItems() {
        let sampleItems = [
            ShelfItem(title: "Research Notes", type: .document),
            ShelfItem(title: "Photos", type: .image),
            ShelfItem(title: "Project Video", type: .video),
            ShelfItem(title: "Playlist", type: .audio),
            ShelfItem(title: "Source Code", type: .code),
            ShelfItem(title: "Archive", type: .archive)
        ]
        
        withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
            for (index, item) in sampleItems.enumerated() {
                var newItem = item
                newItem.targetPosition.x = CGFloat(index) * (slotWidth + 12)
                items.append(newItem)
            }
        }
    }
    
    private func handleExternalDrop(providers: [NSItemProvider]) -> Bool {
        return false
    }
}