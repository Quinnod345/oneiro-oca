struct ContentView: View {
    @State private var items: [ShelfItem] = []
    @State private var draggedItem: ShelfItem?
    @State private var dragOffset: CGSize = .zero
    @State private var hoveredSlot: Int? = nil
    @State private var showingDropZones: Bool = false
    
    let maxItems: Int = 8
    let slotWidth: CGFloat = 140
    let slotHeight: CGFloat = 100
    let shelfHeight: CGFloat = 160
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color(NSColor.windowBackgroundColor)
                    .ignoresSafeArea()
                
                VStack(spacing: 0) {
                    Spacer()
                    
                    Text("Library")
                        .font(.system(size: 24, weight: .semibold, design: .default))
                        .foregroundColor(.primary)
                        .padding(.bottom, 16)
                    
                    ZStack {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color(NSColor.controlBackgroundColor))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(Color(NSColor.separatorColor), lineWidth: 0.5)
                            )
                        
                        HStack(spacing: 8) {
                            ForEach(0..<maxItems, id: \.self) { slotIndex in
                                slotView(for: slotIndex)
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                    .frame(height: shelfHeight)
                    .shadow(color: .black.opacity(0.1), radius: 2, x: 0, y: 1)
                    
                    Spacer().frame(height: 40)
                }
            }
        }
        .onAppear {
            loadSampleItems()
        }
        .onDrop(of: ["public.text"], isTargeted: $showingDropZones) { providers in
            handleDrop(providers: providers)
        }
    }
    
    private func slotView(for index: Int) -> some View {
        let item = items.first { item in
            let slotX = CGFloat(index) * (slotWidth + 8) + slotWidth / 2
            return abs(item.targetPosition.x - slotX) < slotWidth / 2
        }
        
        return ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(NSColor.controlBackgroundColor))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(
                            hoveredSlot == index ? Color.accentColor : Color(NSColor.separatorColor),
                            lineWidth: hoveredSlot == index ? 1 : 0.5
                        )
                )
                .frame(width: slotWidth, height: slotHeight)
                .scaleEffect(hoveredSlot == index ? 1.02 : 1.0)
                .animation(.easeOut(duration: 0.15), value: hoveredSlot)
            
            if let item = item {
                itemView(item: item)
            }
        }
        .onHover { isHovering in
            hoveredSlot = isHovering ? index : nil
        }
        .onDrop(of: ["public.text"], isTargeted: nil) { providers in
            moveItem(to: index, providers: providers)
        }
    }
    
    private func itemView(item: ShelfItem) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(item.color.opacity(0.8))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(item.color.opacity(0.3), lineWidth: 1)
                )
                .frame(width: slotWidth - 8, height: slotHeight - 8)
            
            Text(item.title)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.primary)
                .multilineTextAlignment(.center)
                .padding(8)
        }
        .scaleEffect(draggedItem?.id == item.id ? 1.05 : 1.0)
        .opacity(draggedItem?.id == item.id ? 0.8 : 1.0)
        .offset(draggedItem?.id == item.id ? dragOffset : .zero)
        .animation(.easeInOut(duration: 0.2), value: draggedItem?.id)
        .gesture(
            DragGesture()
                .onChanged { value in
                    if draggedItem == nil {
                        draggedItem = item
                    }
                    dragOffset = value.translation
                }
                .onEnded { value in
                    let newSlot = calculateSlot(from: value.location)
                    moveItemToSlot(item: item, slot: newSlot)
                    draggedItem = nil
                    dragOffset = .zero
                }
        )
    }
    
    private func calculateSlot(from location: CGPoint) -> Int {
        let slotIndex = Int(location.x / (slotWidth + 8))
        return max(0, min(maxItems - 1, slotIndex))
    }
    
    private func moveItemToSlot(item: ShelfItem, slot: Int) {
        withAnimation(.easeInOut(duration: 0.3)) {
            if let index = items.firstIndex(of: item) {
                var updatedItem = item
                let slotX = CGFloat(slot) * (slotWidth + 8) + slotWidth / 2
                updatedItem.targetPosition = CGPoint(x: slotX, y: slotHeight / 2)
                items[index] = updatedItem
            }
        }
    }
    
    private func handleDrop(providers: [NSItemProvider]) -> Bool {
        for provider in providers {
            provider.loadItem(forTypeIdentifier: "public.text", options: nil) { data, error in
                if let data = data as? Data,
                   let text = String(data: data, encoding: .utf8) {
                    DispatchQueue.main.async {
                        let newItem = ShelfItem(
                            title: text,
                            color: [Color.blue, Color.green, Color.orange, Color.purple, Color.red].randomElement() ?? .blue
                        )
                        items.append(newItem)
                        positionItems()
                    }
                }
            }
        }
        return true
    }
    
    private func moveItem(to slot: Int, providers: [NSItemProvider]) -> Bool {
        handleDrop(providers: providers)
    }
    
    private func loadSampleItems() {
        let sampleItems = [
            ShelfItem(title: "Documents", color: .blue),
            ShelfItem(title: "Photos", color: .green),
            ShelfItem(title: "Music", color: .orange),
            ShelfItem(title: "Videos", color: .purple)
        ]
        
        items = sampleItems
        positionItems()
    }
    
    private func positionItems() {
        withAnimation(.easeOut(duration: 0.4)) {
            for (index, item) in items.enumerated() {
                if index < maxItems {
                    let slotX = CGFloat(index) * (slotWidth + 8) + slotWidth / 2
                    var updatedItem = item
                    updatedItem.targetPosition = CGPoint(x: slotX, y: slotHeight / 2)
                    items[index] = updatedItem
                }
            }
        }
    }
}