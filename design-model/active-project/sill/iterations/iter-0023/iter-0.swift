struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(name: "Project Alpha", createdAt: Date().addingTimeInterval(-2 * 24 * 3600), imageName: "folder.fill"),
        ShelfItem(name: "Design Brief", createdAt: Date().addingTimeInterval(-5 * 24 * 3600), imageName: "doc.text.fill"),
        ShelfItem(name: "Assets", createdAt: Date().addingTimeInterval(-1 * 24 * 3600), imageName: "photo.stack.fill")
    ]
    
    @State private var draggedItem: ShelfItem? = nil
    @State private var dragOffset: CGSize = .zero
    @State private var ghostPosition: CGPoint = .zero
    @State private var breathingSlot: Int? = nil
    
    var body: some View {
        ZStack {
            // Background wood texture
            Color(red: 0.35, green: 0.22, blue: 0.12)
                .overlay(WoodGrainTexture())
                .overlay(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.02),
                            Color.clear,
                            Color.black.opacity(0.1)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
            
            VStack(spacing: 20) {
                Spacer()
                
                // Shelf area
                HStack(spacing: 16) {
                    ForEach(0..<8, id: \.self) { index in
                        ZStack {
                            ShelfSlot(
                                index: index,
                                isBreathing: breathingSlot == index,
                                hasItem: index < items.count && items[index].id != draggedItem?.id
                            )
                            
                            if index < items.count && items[index].id != draggedItem?.id {
                                ItemCard(item: items[index], isDragging: false)
                                    .onDrag {
                                        draggedItem = items[index]
                                        return NSItemProvider(object: items[index].name as NSString)
                                    }
                            }
                        }
                    }
                }
                .padding(.horizontal, 40)
                .padding(.bottom, 40)
            }
            
            // Ghost preview
            if let draggedItem = draggedItem {
                GhostPreview(item: draggedItem, position: ghostPosition)
            }
        }
        .frame(width: 1440, height: 900)
        .onDrop(of: [.text], isTargeted: nil) { providers, location in
            draggedItem = nil
            breathingSlot = nil
            return true
        }
        .gesture(
            DragGesture(coordinateSpace: .global)
                .onChanged { value in
                    if draggedItem != nil {
                        ghostPosition = value.location
                        
                        // Calculate which slot we're over
                        let shelfY: CGFloat = 900 - 40 - 80 // Bottom margin + half slot height
                        let startX: CGFloat = 40 + 40 // Left margin + half slot width
                        
                        if abs(value.location.y - shelfY) < 50 {
                            let slotIndex = Int((value.location.x - startX + 48) / 96)
                            breathingSlot = (slotIndex >= 0 && slotIndex < 8) ? slotIndex : nil
                        } else {
                            breathingSlot = nil
                        }
                    }
                }
                .onEnded { _ in
                    draggedItem = nil
                    breathingSlot = nil
                }
        )
    }
}