struct ContentView: View {
    @State private var items: [ShelfItem] = []
    @State private var draggedItem: ShelfItem?
    @State private var hoveredSlot: Int?
    @State private var animationTimer: Timer?
    
    let maxSlots: Int = 8
    let slotWidth: Double = 120.0
    let slotHeight: Double = 60.0
    let shelfPadding: Double = 16.0
    
    var body: some View {
        ZStack {
            // Native macOS background using visual effect
            Rectangle()
                .fill(.regularMaterial)
                .overlay(
                    Rectangle()
                        .fill(.thinMaterial)
                        .opacity(0.5)
                )
            
            // Item slots
            HStack(spacing: 8) {
                ForEach(0..<maxSlots, id: \.self) { slotIndex in
                    let item = items.first { item in
                        items.firstIndex { $0.id == item.id } == slotIndex
                    }
                    
                    ZStack {
                        // Slot indicator with native styling
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(
                                Color.primary.opacity(0.2),
                                lineWidth: hoveredSlot == slotIndex ? 2.0 : 1.0
                            )
                            .fill(.ultraThinMaterial)
                            .animation(.easeInOut(duration: 0.2), value: hoveredSlot)
                        
                        // Item if present
                        if let item = item {
                            VStack(spacing: 6) {
                                Circle()
                                    .fill(Color.accentColor.gradient)
                                    .frame(width: 28, height: 28)
                                    .shadow(color: .accentColor.opacity(0.3), radius: 4, x: 0, y: 2)
                                
                                Text(item.name)
                                    .font(.system(size: 13, weight: .medium, design: .default))
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                            }
                            .scaleEffect(hoveredSlot == slotIndex ? 1.05 : 1.0)
                            .animation(.easeInOut(duration: 0.15), value: hoveredSlot)
                            .onTapGesture {
                                touchItem(item)
                            }
                        }
                    }
                    .frame(width: slotWidth, height: slotHeight)
                    .onDrop(of: ["public.text"], isTargeted: Binding<Bool>(
                        get: { hoveredSlot == slotIndex },
                        set: { if $0 { hoveredSlot = slotIndex } else if hoveredSlot == slotIndex { hoveredSlot = nil } }
                    )) { providers in
                        handleDrop(providers: providers, slotIndex: slotIndex)
                    }
                }
            }
            .padding(.horizontal, shelfPadding)
        }
        .frame(width: Double(maxSlots) * slotWidth + shelfPadding * 2 + Double(maxSlots - 1) * 8, height: slotHeight + 24)
        .onAppear {
            setupSampleItems()
            startAnimationTimer()
        }
        .onDisappear {
            animationTimer?.invalidate()
        }
    }
    
    private func setupSampleItems() {
        items = [
            ShelfItem(name: "Documents"),
            ShelfItem(name: "Pictures"),
            ShelfItem(name: "Downloads")
        ]
    }
    
    private func startAnimationTimer() {
        animationTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
            for i in items.indices {
                items[i].temperature = max(0.1, items[i].temperature - 0.1)
            }
        }
    }
    
    private func touchItem(_ item: ShelfItem) {
        if let index = items.firstIndex(where: { $0.id == item.id }) {
            items[index].temperature = 1.0
        }
    }
    
    private func handleDrop(providers: [NSItemProvider], slotIndex: Int) -> Bool {
        hoveredSlot = nil
        
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier("public.text") {
                provider.loadItem(forTypeIdentifier: "public.text", options: nil) { data, error in
                    if let data = data as? Data,
                       let string = String(data: data, encoding: .utf8) {
                        DispatchQueue.main.async {
                            let newItem = ShelfItem(name: string)
                            
                            if slotIndex < items.count {
                                items[slotIndex] = newItem
                            } else {
                                while items.count < slotIndex {
                                    items.append(ShelfItem(name: "Empty"))
                                }
                                items.append(newItem)
                            }
                        }
                    }
                }
                return true
            }
        }
        return false
    }
}