struct ContentView: View {
    @State private var slots: [DragItem?] = Array(repeating: nil, count: 8)
    @State private var draggedItem: DragItem?
    @State private var dropTargetIndex: Int?
    
    @State private var availableItems: [DragItem] = [
        DragItem(title: "Notes", color: Color.primary.opacity(0.7)),
        DragItem(title: "Calendar", color: Color.primary.opacity(0.6)),
        DragItem(title: "Tasks", color: Color.primary.opacity(0.8)),
        DragItem(title: "Files", color: Color.primary.opacity(0.5)),
        DragItem(title: "Music", color: Color.primary.opacity(0.65))
    ]
    
    var body: some View {
        GeometryReader { geometry in
            let maxSlots = max(4, min(12, Int(geometry.size.width / 96)))
            let currentSlots = min(slots.count, maxSlots)
            
            VStack(spacing: 32) {
                Text("Quick Shelf")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.primary)
                    .padding(.top, 24)
                
                HStack(spacing: 28) {
                    ForEach(0..<currentSlots, id: \.self) { index in
                        SlotWell(
                            index: index,
                            item: slots[index],
                            isDropTarget: dropTargetIndex == index,
                            onDrop: { item in
                                handleDrop(item: item, at: index)
                                return true
                            },
                            onDragStart: {
                                if let item = slots[index] {
                                    removeFromSlot(at: index, item: item)
                                }
                            }
                        )
                    }
                }
                .padding(.horizontal, 24)
                
                if !availableItems.isEmpty {
                    Divider()
                        .padding(.horizontal, 24)
                    
                    Text("Available Items")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(.secondary)
                    
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 20), count: 5), spacing: 20) {
                        ForEach(availableItems) { item in
                            ItemTile(item: item)
                        }
                    }
                    .padding(.horizontal, 24)
                }
            }
            .padding(.bottom, 24)
        }
        .frame(width: 640, height: 320)
        .background(.hudMaterial)
    }
    
    private func handleDrop(item: DragItem, at index: Int) {
        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
            if let existingIndex = slots.firstIndex(where: { $0?.id == item.id }) {
                slots[existingIndex] = nil
            } else {
                availableItems.removeAll { $0.id == item.id }
            }
            
            if let existingItem = slots[index] {
                availableItems.append(existingItem)
            }
            
            slots[index] = item
        }
    }
    
    private func removeFromSlot(at index: Int, item: DragItem) {
        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
            slots[index] = nil
            if !availableItems.contains(where: { $0.id == item.id }) {
                availableItems.append(item)
            }
        }
    }
}

struct ItemTile: View {
    let item: DragItem
    @State private var isHovering = false
    
    var body: some View {
        RoundedRectangle(cornerRadius: 10)
            .fill(.regularMaterial)
            .frame(width: 60, height: 60)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .fill(item.color)
                    .overlay(
                        Text(item.title)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.white)
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                    )
                    .padding(2)
                    .shadow(color: .black.opacity(0.1), radius: 1, x: 0, y: 0.5)
            )
            .scaleEffect(isHovering ? 1.08 : 1.0)
            .draggable(item) {
                RoundedRectangle(cornerRadius: 8)
                    .fill(item.color.opacity(0.95))
                    .frame(width: 56, height: 56)
                    .overlay(
                        Text(item.title)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.white)
                    )
                    .shadow(color: .black.opacity(0.25), radius: 6, x: 0, y: 3)
            }
            .onHover { hovering in
                withAnimation(.spring(response: 0.25, dampingFraction: 0.6)) {
                    isHovering = hovering
                }
            }
            .animation(.spring(response: 0.35, dampingFraction: 0.7), value: availableItems.count)
    }
}