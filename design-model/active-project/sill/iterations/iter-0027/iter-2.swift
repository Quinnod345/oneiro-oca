struct ContentView: View {
    @State private var slots: [DragItem?] = Array(repeating: nil, count: 8)
    @State private var draggedItem: DragItem?
    @State private var dropTargetIndex: Int?
    
    @State private var availableItems: [DragItem] = [
        DragItem(title: "Notes", color: Color(NSColor.controlAccentColor)),
        DragItem(title: "Calendar", color: Color(NSColor.systemRed).opacity(0.8)),
        DragItem(title: "Tasks", color: Color(NSColor.systemBlue).opacity(0.8)),
        DragItem(title: "Files", color: Color(NSColor.systemGreen).opacity(0.8)),
        DragItem(title: "Music", color: Color(NSColor.systemPurple).opacity(0.8))
    ]
    
    var body: some View {
        GeometryReader { geometry in
            let maxSlots = max(4, min(12, Int(geometry.size.width / 80)))
            let currentSlots = min(slots.count, maxSlots)
            
            VStack(spacing: 24) {
                Text("Quick Shelf")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.primary)
                    .padding(.top, 20)
                
                HStack(spacing: 16) {
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
                .padding(.horizontal, 20)
                
                if !availableItems.isEmpty {
                    Divider()
                        .padding(.horizontal, 20)
                    
                    Text("Available Items")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(.secondary)
                    
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: 5), spacing: 16) {
                        ForEach(availableItems) { item in
                            RoundedRectangle(cornerRadius: 8)
                                .fill(item.color)
                                .frame(width: 56, height: 56)
                                .overlay(
                                    Text(item.title)
                                        .font(.system(size: 11, weight: .medium))
                                        .foregroundColor(.white)
                                        .multilineTextAlignment(.center)
                                        .lineLimit(2)
                                )
                                .draggable(item) {
                                    RoundedRectangle(cornerRadius: 8)
                                        .fill(item.color.opacity(0.9))
                                        .frame(width: 56, height: 56)
                                        .overlay(
                                            Text(item.title)
                                                .font(.system(size: 11, weight: .medium))
                                                .foregroundColor(.white)
                                        )
                                }
                                .scaleEffect(1.0)
                                .animation(.spring(response: 0.3, dampingFraction: 0.7), value: availableItems.count)
                        }
                    }
                    .padding(.horizontal, 20)
                }
            }
            .padding(.bottom, 20)
        }
        .frame(width: 640, height: 320)
        .background(.ultraThinMaterial)
    }
    
    private func handleDrop(item: DragItem, at index: Int) {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
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
        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
            slots[index] = nil
            if !availableItems.contains(where: { $0.id == item.id }) {
                availableItems.append(item)
            }
        }
    }
}