struct ContentView: View {
    @State private var slots: [DragItem?] = Array(repeating: nil, count: 8)
    @State private var draggedItem: DragItem?
    @State private var dropTargetIndex: Int?
    
    @State private var availableItems: [DragItem] = [
        DragItem(title: "Notes", color: .orange),
        DragItem(title: "Calendar", color: .red),
        DragItem(title: "Tasks", color: .blue),
        DragItem(title: "Files", color: .green),
        DragItem(title: "Music", color: .purple)
    ]
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Quick Shelf")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.primary)
                .padding(.top, 16)
            
            HStack(spacing: 12) {
                ForEach(0..<8, id: \.self) { index in
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
            .padding(.horizontal, 16)
            
            if !availableItems.isEmpty {
                Divider()
                    .padding(.horizontal, 16)
                
                Text("Available Items")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.secondary)
                
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 5), spacing: 12) {
                    ForEach(availableItems) { item in
                        RoundedRectangle(cornerRadius: 6)
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
                                RoundedRectangle(cornerRadius: 6)
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
                .padding(.horizontal, 16)
            }
        }
        .padding(.bottom, 16)
        .frame(width: 640, height: 320)
        .background(.regularMaterial)
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