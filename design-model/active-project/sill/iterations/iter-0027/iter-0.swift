struct ContentView: View {
    @State private var slots: [DragItem?] = Array(repeating: nil, count: 8)
    @State private var draggedItem: DragItem?
    @State private var dropTargetIndex: Int?
    
    @State private var availableItems: [DragItem] = [
        DragItem(title: "Notes", color: Color.orange),
        DragItem(title: "Calendar", color: Color.red),
        DragItem(title: "Tasks", color: Color.blue),
        DragItem(title: "Files", color: Color.green),
        DragItem(title: "Music", color: Color.purple)
    ]
    
    var body: some View {
        VStack(spacing: 16) {
            Text("Quick Shelf")
                .font(.system(size: 18, weight: .semibold, design: .rounded))
                .foregroundColor(Color(red: 0.45, green: 0.32, blue: 0.18))
                .padding(.top, 8)
            
            HStack(spacing: 8) {
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
            .padding(.horizontal, 12)
            
            if !availableItems.isEmpty {
                Divider()
                    .background(Color(red: 0.77, green: 0.59, blue: 0.42))
                
                Text("Available Items")
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundColor(Color(red: 0.45, green: 0.32, blue: 0.18))
                
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                    ForEach(availableItems) { item in
                        RoundedRectangle(cornerRadius: 8)
                            .fill(item.color.opacity(0.9))
                            .frame(width: 52, height: 52)
                            .overlay(
                                Text(item.title)
                                    .font(.system(size: 10, weight: .medium, design: .rounded))
                                    .foregroundColor(Color.white)
                                    .multilineTextAlignment(.center)
                                    .lineLimit(2)
                            )
                            .draggable(item) {
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(item.color.opacity(0.8))
                                    .frame(width: 52, height: 52)
                                    .overlay(
                                        Text(item.title)
                                            .font(.system(size: 10, weight: .medium, design: .rounded))
                                            .foregroundColor(Color.white)
                                    )
                            }
                    }
                }
                .padding(.horizontal, 12)
            }
        }
        .padding(.bottom, 12)
        .frame(width: 640, height: 280)
        .background(Color(red: 0.96, green: 0.94, blue: 0.90))
    }
    
    private func handleDrop(item: DragItem, at index: Int) {
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
    
    private func removeFromSlot(at index: Int, item: DragItem) {
        slots[index] = nil
        if !availableItems.contains(where: { $0.id == item.id }) {
            availableItems.append(item)
        }
    }
}