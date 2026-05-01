struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(name: "Notes", age: 300, icon: "note.text"),
        ShelfItem(name: "Photos", age: 600, icon: "photo"),
        ShelfItem(name: "Music", age: 1800, icon: "music.note"),
        ShelfItem(name: "Mail", age: 2400, icon: "envelope"),
        ShelfItem(name: "Calendar", age: 3200, icon: "calendar")
    ]
    
    @State private var draggedItem: ShelfItem?
    @State private var hoveredItem: ShelfItem?
    
    var body: some View {
        ZStack {
            Color.clear
                .frame(width: 720, height: 140)
                .background(.regularMaterial)
            
            HStack(alignment: .bottom, spacing: 4) {
                ForEach(items) { item in
                    SlotView(
                        item: item,
                        isHovered: hoveredItem?.id == item.id
                    )
                    .onHover { isHovering in
                        withAnimation(.easeInOut(duration: 0.2)) {
                            hoveredItem = isHovering ? item : nil
                        }
                    }
                    .onDrag {
                        draggedItem = item
                        return NSItemProvider(object: item.name as NSString)
                    }
                    .onDrop(of: [.text], delegate: DropDelegate(
                        item: item,
                        items: $items,
                        draggedItem: $draggedItem
                    ))
                    .scaleEffect(hoveredItem?.id == item.id ? 1.1 : 1.0)
                    .animation(.spring(response: 0.3, dampingFraction: 0.7), value: hoveredItem?.id)
                }
            }
            .padding(20)
        }
    }
}

struct SlotView: View {
    let item: ShelfItem
    let isHovered: Bool
    
    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                Circle()
                    .fill(.ultraThinMaterial)
                    .frame(width: item.slotSize + 16, height: item.slotSize + 16)
                    .overlay(
                        Circle()
                            .stroke(
                                LinearGradient(
                                    colors: [.white.opacity(0.3), .clear],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                lineWidth: 1
                            )
                    )
                    .shadow(color: .black.opacity(0.15), radius: 4, y: 2)
                
                Image(systemName: item.icon)
                    .font(.system(size: 28, weight: .light))
                    .foregroundStyle(.primary)
                    .opacity(item.opacity)
                    .blur(radius: item.blur * 0.3)
                    .overlay(
                        Image(systemName: item.icon)
                            .font(.system(size: 28, weight: .light))
                            .foregroundStyle(item.colorTemperature)
                            .opacity(item.colorTemperature.opacity)
                            .blendMode(.overlay)
                    )
            }
            
            Text(item.name)
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
                .opacity(item.opacity * 0.9)
                .multilineTextAlignment(.center)
        }
        .frame(width: max(60, item.slotSize + 20), height: 100)
        .scaleEffect(item.scale)
        .rotation3DEffect(
            .degrees(isHovered ? 5 : 0),
            axis: (x: 1, y: 0, z: 0),
            perspective: 0.8
        )
    }
}

struct DropDelegate: DropDelegate {
    let item: ShelfItem
    @Binding var items: [ShelfItem]
    @Binding var draggedItem: ShelfItem?
    
    func performDrop(info: DropInfo) -> Bool {
        guard let draggedItem = draggedItem else { return false }
        
        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
            if let fromIndex = items.firstIndex(where: { $0.id == draggedItem.id }),
               let toIndex = items.firstIndex(where: { $0.id == item.id }) {
                items.move(fromOffsets: IndexSet([fromIndex]), toOffset: toIndex > fromIndex ? toIndex + 1 : toIndex)
            }
        }
        
        self.draggedItem = nil
        return true
    }
}