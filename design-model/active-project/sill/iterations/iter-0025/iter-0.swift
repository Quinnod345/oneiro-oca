struct ContentView: View {
    @State private var items: [Item] = [
        Item(title: "Project Alpha", color: .blue),
        Item(title: "Design Review", color: .orange),
        Item(title: "Weekly Sync", color: .green),
        Item(title: "Client Call", color: .purple)
    ]
    
    @State private var shelfItems: [Item?] = Array(repeating: nil, count: 6)
    @State private var draggedItem: Item? = nil
    @State private var ghostSlots: Set<Int> = []
    @State private var animatingSlots: Set<Int> = []
    @State private var shelfAppeared: Bool = false
    
    var body: some View {
        HStack(spacing: 60) {
            VStack(spacing: 20) {
                Text("Items")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundColor(.primary)
                
                VStack(spacing: 12) {
                    ForEach(items) { item in
                        ItemCard(item: item)
                            .draggable(item) {
                                ItemCard(item: item)
                                    .opacity(0.8)
                                    .scaleEffect(0.9)
                            }
                    }
                }
            }
            .frame(width: 200)
            
            VStack(spacing: 20) {
                Text("Shelf")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundColor(.primary)
                
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(120), spacing: 16), count: 3), spacing: 16) {
                    ForEach(0..<6, id: \.self) { index in
                        ShelfSlot(
                            item: shelfItems[index],
                            isAnimating: animatingSlots.contains(index),
                            hasGhost: ghostSlots.contains(index)
                        )
                        .dropDestination(for: Item.self) { droppedItems, location in
                            guard let item = droppedItems.first else { return false }
                            
                            withAnimation(.spring(response: 0.35, dampingFraction: 0.7, blendDuration: 0)) {
                                shelfItems[index] = item
                                animatingSlots.insert(index)
                                items.removeAll { $0.id == item.id }
                            }
                            
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                                animatingSlots.remove(index)
                            }
                            
                            return true
                        } isTargeted: { isTargeted in
                            // Visual feedback handled by slot itself
                        }
                        .simultaneousGesture(
                            DragGesture()
                                .onChanged { value in
                                    if shelfItems[index] != nil && draggedItem == nil {
                                        draggedItem = shelfItems[index]
                                    }
                                }
                                .onEnded { value in
                                    if let item = shelfItems[index] {
                                        shelfItems[index] = nil
                                        items.append(item)
                                        
                                        ghostSlots.insert(index)
                                        
                                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                                            ghostSlots.remove(index)
                                        }
                                    }
                                    draggedItem = nil
                                }
                        )
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0.96, green: 0.96, blue: 0.97))
        .onAppear {
            withAnimation(.easeInOut(duration: 1.2)) {
                shelfAppeared = true
            }
        }
    }
}

struct ItemCard: View {
    let item: Item
    @State private var floatOffset: Double = 0
    
    var body: some View {
        HStack {
            Circle()
                .fill(item.color)
                .frame(width: 12, height: 12)
            
            Text(item.title)
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.primary)
            
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.white)
                .shadow(color: Color.black.opacity(0.08), radius: 2, x: 0, y: 1)
        )
        .offset(y: floatOffset)
        .onAppear {
            startFloating()
        }
    }
    
    private func startFloating() -> Void {
        let timer = Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { _ in
            let time = Date().timeIntervalSince1970
            floatOffset = sin(time * 0.3 * 2 * .pi) * 1.5
        }
        RunLoop.current.add(timer, forMode: .common)
    }
}

struct ShelfSlot: View {
    let item: Item?
    let isAnimating: Bool
    let hasGhost: Bool
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.8, green: 0.6, blue: 0.4),
                            Color(red: 0.7, green: 0.5, blue: 0.3),
                            Color(red: 0.9, green: 0.7, blue: 0.5)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color(red: 0.6, green: 0.4, blue: 0.2).opacity(0.3), lineWidth: 1)
                )
                .frame(width: 120, height: 80)
                .scaleEffect(isAnimating ? 1.08 : 1.0)
            
            if let item = item {
                VStack(spacing: 6) {
                    Circle()
                        .fill(item.color)
                        .frame(width: 16, height: 16)
                    
                    Text(item.title)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.white)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                }
                .padding(8)
            }
            
            if hasGhost && item == nil {
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.white, lineWidth: 1)
                    .frame(width: 120, height: 80)
                    .opacity(0)
                    .onAppear {
                        withAnimation(.easeOut(duration: 0.4)) {
                            // Opacity managed by hasGhost state
                        }
                    }
            }
        }
    }
}