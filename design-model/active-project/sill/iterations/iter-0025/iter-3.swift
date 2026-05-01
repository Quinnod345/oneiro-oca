struct ContentView: View {
    @State private var items: [Item] = [
        Item(title: "Project Alpha", color: Color.blue, icon: "folder.fill"),
        Item(title: "Design Review", color: Color.orange, icon: "paintbrush.fill"),
        Item(title: "Weekly Sync", color: Color.green, icon: "calendar"),
        Item(title: "Client Call", color: Color.purple, icon: "phone.fill")
    ]
    
    @State private var shelfItems: [Item?] = Array(repeating: nil, count: 6)
    @State private var draggedItem: Item? = nil
    @State private var targetedSlots: Set<Int> = []
    
    var body: some View {
        HStack(spacing: 40) {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Available Tasks")
                        .font(.system(size: 24, weight: .bold, design: .rounded))
                        .foregroundColor(.primary)
                    
                    Text("Drag items to organize your workflow")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.secondary)
                }
                
                VStack(spacing: 12) {
                    ForEach(items) { item in
                        ItemCard(item: item)
                            .draggable(item) {
                                ItemCard(item: item)
                                    .opacity(0.8)
                                    .scaleEffect(0.9)
                                    .shadow(color: item.color.opacity(0.4), radius: 20, x: 0, y: 10)
                            }
                    }
                }
            }
            .frame(width: 280)
            
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Active Collection")
                        .font(.system(size: 24, weight: .bold, design: .rounded))
                        .foregroundColor(.primary)
                    
                    Text("\(shelfItems.compactMap { $0 }.count) of 6 slots filled")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.secondary)
                }
                
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(120), spacing: 20), count: 3), spacing: 20) {
                    ForEach(0..<6, id: \.self) { index in
                        ShelfSlot(
                            item: shelfItems[index],
                            isTargeted: targetedSlots.contains(index)
                        )
                        .dropDestination(for: Item.self) { droppedItems, location in
                            guard let item = droppedItems.first else { return false }
                            
                            withAnimation(.spring(response: 0.5, dampingFraction: 0.6)) {
                                shelfItems[index] = item
                                items.removeAll { $0.id == item.id }
                            }
                            
                            return true
                        } isTargeted: { isTargeted in
                            withAnimation(.easeInOut(duration: 0.3)) {
                                if isTargeted {
                                    targetedSlots.insert(index)
                                } else {
                                    targetedSlots.remove(index)
                                }
                            }
                        }
                        .onTapGesture {
                            if let item = shelfItems[index] {
                                withAnimation(.spring(response: 0.5, dampingFraction: 0.6)) {
                                    shelfItems[index] = nil
                                    items.append(item)
                                }
                            }
                        }
                    }
                }
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(NSColor.windowBackgroundColor))
    }
}

struct ItemCard: View {
    let item: Item
    @State private var isHovered = false
    
    var body: some View {
        HStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(item.color.gradient)
                    .frame(width: 44, height: 44)
                    .shadow(color: item.color.opacity(0.3), radius: 8, x: 0, y: 4)
                
                Image(systemName: item.icon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)
            }
            
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.primary)
                
                Text("Ready to organize")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.secondary)
            }
            
            Spacer()
            
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(item.color)
                .opacity(isHovered ? 1 : 0.5)
                .scaleEffect(isHovered ? 1.1 : 1.0)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(.regularMaterial)
                .stroke(item.color.opacity(isHovered ? 0.3 : 0.1), lineWidth: 2)
                .shadow(color: .black.opacity(isHovered ? 0.15 : 0.08), radius: isHovered ? 12 : 6, x: 0, y: isHovered ? 8 : 4)
        )
        .scaleEffect(isHovered ? 1.05 : 1.0)
        .onHover { hovering in
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                isHovered = hovering
            }
        }
    }
}

struct ShelfSlot: View {
    let item: Item?
    let isTargeted: Bool
    @State private var isHovered = false
    
    var body: some View {
        Group {
            if let item = item {
                VStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(item.color.gradient)
                            .frame(width: 40, height: 40)
                            .shadow(color: item.color.opacity(0.4), radius: 8, x: 0, y: 4)
                        
                        Image(systemName: item.icon)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.white)
                    }
                    
                    Text(item.title)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.primary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                }
                .padding(16)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(.thickMaterial)
                        .stroke(item.color.opacity(0.3), lineWidth: 2)
                        .shadow(color: item.color.opacity(0.2), radius: 8, x: 0, y: 4)
                )
                .scaleEffect(isHovered ? 1.05 : 1.0)
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "plus.circle.dashed")
                        .font(.system(size: 24, weight: .medium))
                        .foregroundColor(.secondary)
                    
                    Text("Drop here")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.tertiary)
                }
                .frame(height: 96)
                .frame(maxWidth: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(.ultraThinMaterial)
                        .stroke(
                            isTargeted ? Color.blue : Color.secondary.opacity(0.3),
                            lineWidth: isTargeted ? 3 : 1
                        )
                        .shadow(
                            color: isTargeted ? Color.blue.opacity(0.3) : .clear,
                            radius: isTargeted ? 12 : 0,
                            x: 0,
                            y: 4
                        )
                )
                .scaleEffect(isTargeted ? 1.1 : 1.0)
            }
        }
        .onHover { hovering in
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                isHovered = hovering
            }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: isTargeted)
    }
}