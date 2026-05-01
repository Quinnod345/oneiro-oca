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
            // Native macOS background with materials
            Rectangle()
                .fill(.regularMaterial)
                .overlay(
                    Rectangle()
                        .fill(.thinMaterial)
                        .opacity(0.5)
                )
                .background(Color.accentColor.opacity(0.02))
            
            VStack(spacing: 30) {
                Spacer()
                
                // Title with proper SF Pro hierarchy
                Text("Digital Shelf")
                    .font(.system(.largeTitle, design: .default, weight: .medium))
                    .foregroundStyle(.primary)
                    .padding(.top, 40)
                
                Spacer()
                
                // Shelf area
                HStack(spacing: 20) {
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
                .padding(.horizontal, 60)
                .padding(.bottom, 60)
            }
            
            // Ghost preview
            if let draggedItem = draggedItem {
                GhostPreview(item: draggedItem, position: ghostPosition)
            }
        }
        .preferredColorScheme(.dark)
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
                        let shelfY: CGFloat = 600 // Approximate shelf position
                        let startX: CGFloat = 100 // Approximate start position
                        
                        if abs(value.location.y - shelfY) < 60 {
                            let slotIndex = Int((value.location.x - startX + 50) / 100)
                            breathingSlot = (slotIndex >= 0 && slotIndex < 8) ? slotIndex : nil
                        } else {
                            breathingSlot = nil
                        }
                    }
                }
                .onEnded { _ in
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                        draggedItem = nil
                        breathingSlot = nil
                    }
                }
        )
    }
}

struct ShelfSlot: View {
    let index: Int
    let isBreathing: Bool
    let hasItem: Bool
    
    var body: some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(.ultraThinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(.quaternary, lineWidth: 1)
            )
            .frame(width: 80, height: 100)
            .scaleEffect(isBreathing ? 1.05 : 1.0)
            .shadow(color: .primary.opacity(0.1), radius: isBreathing ? 8 : 2, y: isBreathing ? 4 : 1)
            .animation(.spring(response: 0.35, dampingFraction: 0.8), value: isBreathing)
    }
}

struct ItemCard: View {
    let item: ShelfItem
    let isDragging: Bool
    
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: item.imageName)
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(.tint)
                .frame(width: 32, height: 32)
            
            Text(item.name)
                .font(.system(.caption, design: .default, weight: .medium))
                .foregroundStyle(.primary)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 60)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(.thickMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(.tertiary, lineWidth: 0.5)
                )
        )
        .scaleEffect(isDragging ? 1.1 : 1.0)
        .shadow(color: .primary.opacity(isDragging ? 0.2 : 0.05), radius: isDragging ? 12 : 3, y: isDragging ? 6 : 1)
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: isDragging)
    }
}

struct GhostPreview: View {
    let item: ShelfItem
    let position: CGPoint
    
    var body: some View {
        ItemCard(item: item, isDragging: true)
            .opacity(0.8)
            .position(position)
            .allowsHitTesting(false)
    }
}