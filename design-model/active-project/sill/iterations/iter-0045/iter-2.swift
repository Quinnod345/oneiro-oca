struct ContentView: View {
    @State private var items: [ShelfItem] = []
    @State private var draggedItem: ShelfItem?
    @State private var dragOffset: CGSize = .zero
    @State private var hoveredSlot: Int? = nil
    @State private var showingDropZones: Bool = false
    
    let maxItems: Int = 8
    let slotWidth: CGFloat = 140
    let slotHeight: CGFloat = 100
    let shelfHeight: CGFloat = 180
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color(NSColor.windowBackgroundColor)
                    .ignoresSafeArea()
                
                VStack(spacing: 0) {
                    Spacer()
                    
                    VStack(spacing: 8) {
                        Text("Library")
                            .font(.custom("SF Pro Display", size: 28).weight(.medium))
                            .foregroundColor(.primary)
                        
                        Text("Drag items to organize your collection")
                            .font(.system(size: 11, weight: .regular))
                            .foregroundColor(.secondary)
                    }
                    .padding(.bottom, 24)
                    
                    ZStack {
                        VisualEffectView(material: .hudWindow, blendingMode: .behindWindow)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                        
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(Color(NSColor.separatorColor).opacity(0.3), lineWidth: 0.5)
                        
                        HStack(spacing: 16) {
                            ForEach(0..<maxItems, id: \.self) { slotIndex in
                                slotView(for: slotIndex)
                            }
                        }
                        .padding(.horizontal, 24)
                    }
                    .frame(height: shelfHeight)
                    .shadow(color: .black.opacity(0.08), radius: 8, x: 0, y: 2)
                    
                    Spacer().frame(height: 60)
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
            let slotX = CGFloat(index) * (slotWidth + 16) + slotWidth / 2
            return abs(item.targetPosition.x - slotX) < slotWidth / 2
        }
        
        return ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(NSColor.controlBackgroundColor).opacity(0.6))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(
                            hoveredSlot == index ? Color(NSColor.systemBlue) : Color(NSColor.separatorColor).opacity(0.5),
                            lineWidth: hoveredSlot == index ? 1.5 : 0.5
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
            RoundedRectangle(cornerRadius: 10)
                .fill(item.color.opacity(0.15))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(item.color.opacity(0.4), lineWidth: 1)
                )
                .frame(width: slotWidth - 12, height: slotHeight - 12)
            
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
        let slotIndex = Int(location.x / (slotWidth + 16))
        return max(0, min(maxItems - 1, slotIndex))
    }
    
    private func moveItemToSlot(item: ShelfItem, slot: Int) {
        withAnimation(.easeInOut(duration: 0.3)) {
            if let index = items.firstIndex(of: item) {
                var updatedItem = item
                let slotX = CGFloat(slot) * (slotWidth + 16) + slotWidth / 2
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
                            color: [Color(NSColor.systemBlue), Color(NSColor.systemGreen), Color(NSColor.systemOrange), Color(NSColor.systemPurple)].randomElement() ?? Color(NSColor.systemBlue)
                        )
                        items.append(newItem)
                    }
                }
            }
        }
        return true
    }
    
    private func moveItem(to slotIndex: Int, providers: [NSItemProvider]) -> Bool {
        handleDrop(providers: providers)
        return true
    }
    
    private func loadSampleItems() {
        let sampleItems = [
            ShelfItem(title: "Documents", color: Color(NSColor.systemBlue)),
            ShelfItem(title: "Photos", color: Color(NSColor.systemGreen)),
            ShelfItem(title: "Music", color: Color(NSColor.systemOrange)),
            ShelfItem(title: "Videos", color: Color(NSColor.systemPurple))
        ]
        
        for (index, item) in sampleItems.enumerated() {
            var positionedItem = item
            let slotX = CGFloat(index) * (slotWidth + 16) + slotWidth / 2
            positionedItem.targetPosition = CGPoint(x: slotX, y: slotHeight / 2)
            items.append(positionedItem)
        }
    }
}

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: NSViewRepresentableContext<Self>) -> NSVisualEffectView {
        let visualEffectView = NSVisualEffectView()
        visualEffectView.material = material
        visualEffectView.blendingMode = blendingMode
        visualEffectView.state = .active
        return visualEffectView
    }
    
    func updateNSView(_ visualEffectView: NSVisualEffectView, context: NSViewRepresentableContext<Self>) {
        visualEffectView.material = material
        visualEffectView.blendingMode = blendingMode
    }
}