struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(name: "Project Alpha", createdAt: Date().addingTimeInterval(-2 * 24 * 3600), imageName: "folder.fill"),
        ShelfItem(name: "Design Brief", createdAt: Date().addingTimeInterval(-5 * 24 * 3600), imageName: "doc.text.fill"),
        ShelfItem(name: "Assets", createdAt: Date().addingTimeInterval(-1 * 24 * 3600), imageName: "photo.stack.fill")
    ]
    
    @State private var draggedItem: ShelfItem? = nil
    @State private var ghostPosition: CGPoint = .zero
    @State private var targetSlot: Int? = nil
    
    var body: some View {
        ZStack {
            Color(red: 0.08, green: 0.08, blue: 0.09)
                .ignoresSafeArea()
            
            VStack(spacing: 40) {
                Spacer()
                
                Text("Digital Shelf")
                    .font(.system(size: 34, weight: .medium))
                    .foregroundColor(.white.opacity(0.95))
                    .padding(.top, 40)
                
                Spacer()
                
                HStack(spacing: 16) {
                    ForEach(0..<8, id: \.self) { index in
                        ShelfSlot(
                            index: index,
                            isHighlighted: targetSlot == index,
                            hasItem: index < items.count
                        )
                        .overlay(
                            Group {
                                if index < items.count && draggedItem?.id != items[index].id {
                                    ItemCard(item: items[index])
                                        .onDrag {
                                            draggedItem = items[index]
                                            return NSItemProvider(object: items[index].name as NSString)
                                        }
                                }
                            }
                        )
                        .onDrop(of: [.text], delegate: SlotDropDelegate(
                            slotIndex: index,
                            items: $items,
                            draggedItem: $draggedItem,
                            targetSlot: $targetSlot
                        ))
                    }
                }
                .padding(.horizontal, 40)
                .padding(.bottom, 80)
            }
            
            if let draggedItem = draggedItem {
                GhostPreview(item: draggedItem)
                    .position(ghostPosition)
                    .allowsHitTesting(false)
            }
        }
        .preferredColorScheme(.dark)
        .gesture(
            DragGesture(coordinateSpace: .global)
                .onChanged { value in
                    if draggedItem != nil {
                        ghostPosition = value.location
                        
                        let slotWidth: CGFloat = 90
                        let slotSpacing: CGFloat = 16
                        let totalSlotWidth = slotWidth + slotSpacing
                        let shelfStartX: CGFloat = 100
                        let shelfY: CGFloat = 500
                        
                        if abs(value.location.y - shelfY) < 80 {
                            let slotIndex = Int((value.location.x - shelfStartX + slotWidth/2) / totalSlotWidth)
                            targetSlot = (slotIndex >= 0 && slotIndex < 8) ? slotIndex : nil
                        } else {
                            targetSlot = nil
                        }
                    }
                }
                .onEnded { _ in
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                        draggedItem = nil
                        targetSlot = nil
                    }
                }
        )
    }
}

struct ShelfSlot: View {
    let index: Int
    let isHighlighted: Bool
    let hasItem: Bool
    
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(
                LinearGradient(
                    colors: [
                        Color(red: 0.24, green: 0.15, blue: 0.14),
                        Color(red: 0.20, green: 0.12, blue: 0.11)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(
                        isHighlighted ? Color.blue.opacity(0.6) : Color.white.opacity(0.1),
                        lineWidth: isHighlighted ? 2 : 1
                    )
            )
            .frame(width: 90, height: 110)
            .shadow(
                color: Color.black.opacity(0.3),
                radius: isHighlighted ? 8 : 3,
                x: 0,
                y: isHighlighted ? 6 : 2
            )
            .scaleEffect(isHighlighted ? 1.02 : 1.0)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHighlighted)
    }
}

struct ItemCard: View {
    let item: ShelfItem
    
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: item.imageName)
                .font(.system(size: 26, weight: .medium))
                .foregroundColor(colorForItem(item.imageName))
                .frame(width: 32, height: 32)
            
            Text(item.name)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.white.opacity(0.9))
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 70)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 8)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(Color.black.opacity(0.2))
        )
        .shadow(color: Color.black.opacity(0.2), radius: 2, x: 0, y: 1)
    }
    
    private func colorForItem(_ imageName: String) -> Color {
        switch imageName {
        case "folder.fill":
            return Color.blue.opacity(0.8)
        case "doc.text.fill":
            return Color.green.opacity(0.8)
        case "photo.stack.fill":
            return Color.orange.opacity(0.8)
        default:
            return Color.white.opacity(0.8)
        }
    }
}

struct GhostPreview: View {
    let item: ShelfItem
    
    var body: some View {
        ItemCard(item: item)
            .opacity(0.8)
            .scaleEffect(1.1)
            .shadow(color: Color.black.opacity(0.4), radius: 12, x: 0, y: 8)
    }
}

struct SlotDropDelegate: DropDelegate {
    let slotIndex: Int
    @Binding var items: [ShelfItem]
    @Binding var draggedItem: ShelfItem?
    @Binding var targetSlot: Int?
    
    func dropEntered(info: DropInfo) {
        targetSlot = slotIndex
    }
    
    func dropExited(info: DropInfo) {
        if targetSlot == slotIndex {
            targetSlot = nil
        }
    }
    
    func performDrop(info: DropInfo) -> Bool {
        guard let draggedItem = draggedItem else { return false }
        
        if let currentIndex = items.firstIndex(where: { $0.id == draggedItem.id }) {
            items.remove(at: currentIndex)
            
            let newIndex = min(slotIndex, items.count)
            items.insert(draggedItem, at: newIndex)
        }
        
        self.draggedItem = nil
        targetSlot = nil
        return true
    }
}