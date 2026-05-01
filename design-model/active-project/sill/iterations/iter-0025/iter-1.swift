struct ContentView: View {
    @State private var items: [Item] = [
        Item(title: "Project Alpha", color: .accentColor),
        Item(title: "Design Review", color: .orange),
        Item(title: "Weekly Sync", color: .green),
        Item(title: "Client Call", color: .purple)
    ]
    
    @State private var shelfItems: [Item?] = Array(repeating: nil, count: 6)
    @State private var draggedItem: Item? = nil
    @State private var targetedSlots: Set<Int> = []
    
    var body: some View {
        HStack(spacing: 40) {
            VStack(spacing: 16) {
                HStack {
                    Image(systemName: "square.stack.3d.down.right")
                        .foregroundColor(.accentColor)
                    Text("Available Items")
                        .font(.title3)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)
                }
                
                VStack(spacing: 8) {
                    ForEach(items) { item in
                        ItemCard(item: item)
                            .draggable(item) {
                                ItemCard(item: item)
                                    .opacity(0.9)
                                    .scaleEffect(0.95)
                            }
                    }
                }
            }
            .frame(width: 220)
            
            VStack(spacing: 16) {
                HStack {
                    Image(systemName: "tray.2")
                        .foregroundColor(.accentColor)
                    Text("Collection")
                        .font(.title3)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)
                }
                
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(100), spacing: 12), count: 3), spacing: 12) {
                    ForEach(0..<6, id: \.self) { index in
                        ShelfSlot(
                            item: shelfItems[index],
                            isTargeted: targetedSlots.contains(index)
                        )
                        .dropDestination(for: Item.self) { droppedItems, location in
                            guard let item = droppedItems.first else { return false }
                            
                            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                                shelfItems[index] = item
                                items.removeAll { $0.id == item.id }
                            }
                            
                            return true
                        } isTargeted: { isTargeted in
                            withAnimation(.easeInOut(duration: 0.2)) {
                                if isTargeted {
                                    targetedSlots.insert(index)
                                } else {
                                    targetedSlots.remove(index)
                                }
                            }
                        }
                        .onTapGesture {
                            if let item = shelfItems[index] {
                                withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                                    shelfItems[index] = nil
                                    items.append(item)
                                }
                            }
                        }
                    }
                }
            }
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            Rectangle()
                .fill(.regularMaterial)
                .ignoresSafeArea()
        )
    }
}

struct ItemCard: View {
    let item: Item
    @State private var isHovered = false
    
    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(item.color.gradient)
                .frame(width: 8, height: 8)
            
            Text(item.title)
                .font(.body)
                .fontWeight(.medium)
                .foregroundColor(.primary)
            
            Spacer()
            
            Image(systemName: "arrow.right")
                .font(.caption)
                .foregroundColor(.secondary)
                .opacity(isHovered ? 1 : 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(.regularMaterial)
                .shadow(color: .black.opacity(0.04), radius: 1, x: 0, y: 1)
        )
        .scaleEffect(isHovered ? 1.02 : 1.0)
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.2)) {
                isHovered = hovering
            }
        }
    }
}

struct ShelfSlot: View {
    let item: Item?
    let isTargeted: Bool
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(.thickMaterial)
                .stroke(isTargeted ? Color.accentColor : Color.clear, lineWidth: 2)
                .frame(width: 100, height: 80)
            
            if let item = item {
                VStack(spacing: 6) {
                    Circle()
                        .fill(item.color.gradient)
                        .frame(width: 16, height: 16)
                    
                    Text(item.title)
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                }
                .padding(8)
            } else {
                Image(systemName: "plus")
                    .font(.title2)
                    .foregroundColor(.secondary)
                    .opacity(isTargeted ? 0 : 0.3)
            }
        }
        .scaleEffect(isTargeted ? 1.05 : 1.0)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isTargeted)
    }
}