struct ContentView: View {
    @State private var items: [Item] = [
        Item(title: "Project Alpha", color: Color.blue.opacity(0.1), icon: "folder.fill"),
        Item(title: "Design Review", color: Color.orange.opacity(0.1), icon: "paintbrush.fill"),
        Item(title: "Weekly Sync", color: Color.green.opacity(0.1), icon: "calendar"),
        Item(title: "Client Call", color: Color.purple.opacity(0.1), icon: "phone.fill")
    ]
    
    @State private var shelfItems: [Item?] = Array(repeating: nil, count: 6)
    @State private var draggedItem: Item? = nil
    @State private var targetedSlots: Set<Int> = []
    
    var body: some View {
        HStack(spacing: 32) {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Available Tasks")
                        .font(.system(size: 20, weight: .semibold, design: .rounded))
                        .foregroundColor(.primary)
                    
                    Text("Drag items to organize")
                        .font(.system(size: 13, weight: .regular))
                        .foregroundColor(.secondary)
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
            .frame(width: 240)
            
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Active Collection")
                        .font(.system(size: 20, weight: .semibold, design: .rounded))
                        .foregroundColor(.primary)
                    
                    Text("\(shelfItems.compactMap { $0 }.count) of 6 slots filled")
                        .font(.system(size: 13, weight: .regular))
                        .foregroundColor(.secondary)
                }
                
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(110), spacing: 16), count: 3), spacing: 16) {
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
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(
            LinearGradient(
                colors: [
                    Color(red: 0.98, green: 0.98, blue: 1.0),
                    Color(red: 0.96, green: 0.97, blue: 0.99)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
        )
    }
}

struct ItemCard: View {
    let item: Item
    @State private var isHovered = false
    
    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 6)
                    .fill(item.color)
                    .frame(width: 28, height: 28)
                
                Image(systemName: item.icon)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.primary)
            }
            
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.primary)
                
                Text("Ready to organize")
                    .font(.system(size: 11, weight: .regular))
                    .foregroundColor(.secondary)
            }
            
            Spacer()
            
            Image(systemName: "chevron.right")
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.secondary)
                .opacity(isHovered ? 1 : 0.3)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(.regularMaterial)
                .shadow(color: .black.opacity(isHovered ? 0.12 : 0.06), radius: isHovered ? 8 : 4, x: 0, y: isHovered ? 4 : 2)
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
            RoundedRectangle(cornerRadius: 12)
                .fill(.thickMaterial)
                .stroke(
                    isTargeted ? 
                        LinearGradient(colors: [.blue, .purple], startPoint: .topLeading, endPoint: .bottomTrailing) :
                        LinearGradient(colors: [.clear], startPoint: .center, endPoint: .center),
                    lineWidth: isTargeted ? 2 : 1
                )
                .frame(width: 110, height: 90)
                .shadow(color: .black.opacity(0.06), radius: 4, x: 0, y: 2)
            
            if let item = item {
                VStack(spacing: 8) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 6)
                            .fill(item.color)
                            .frame(width: 32, height: 32)
                        
                        Image(systemName: item.icon)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.primary)
                    }
                    
                    Text(item.title)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.primary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                }
                .padding(8)
            } else {
                VStack(spacing: 4) {
                    Image(systemName: "plus.circle.dashed")
                        .font(.system(size: 20, weight: .light))
                        .foregroundColor(.secondary)
                        .opacity(isTargeted ? 0 : 0.4)
                    
                    Text("Drop here")
                        .font(.system(size: 10, weight: .regular))
                        .foregroundColor(.secondary)
                        .opacity(isTargeted ? 0 : 0.3)
                }
            }
        }
        .scaleEffect(isTargeted ? 1.05 : 1.0)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isTargeted)
    }
}