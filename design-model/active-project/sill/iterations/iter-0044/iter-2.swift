struct ContentView: View {
    @State private var items: [ShelfItem] = []
    @State private var draggedItem: ShelfItem?
    @State private var hoveredSlot: Int?
    @State private var animationTimer: Timer?
    @State private var numberOfSlots: Int = 4
    
    let maxSlots: Int = 8
    let slotHeight: Double = 80.0
    let shelfPadding: Double = 20.0
    
    private var dynamicSlotWidth: Double {
        max(100.0, min(140.0, 120.0 + Double(items.count) * 5))
    }
    
    var body: some View {
        ZStack {
            Rectangle()
                .fill(.regularMaterial)
                .overlay(
                    Rectangle()
                        .fill(.thinMaterial)
                        .opacity(0.3)
                )
            
            HStack(spacing: 12) {
                ForEach(0..<numberOfSlots, id: \.self) { slotIndex in
                    let item = items.indices.contains(slotIndex) ? items[slotIndex] : nil
                    
                    ZStack {
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(
                                hoveredSlot == slotIndex ? Color.accentColor : Color.primary.opacity(0.15),
                                lineWidth: hoveredSlot == slotIndex ? 2.0 : 1.0
                            )
                            .fill(.ultraThinMaterial)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(Color.accentColor.opacity(hoveredSlot == slotIndex ? 0.1 : 0))
                            )
                            .animation(.easeInOut(duration: 0.2), value: hoveredSlot)
                        
                        if let item = item {
                            VStack(spacing: 8) {
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(Color.accentColor.gradient)
                                    .frame(width: 36, height: 36)
                                    .overlay(
                                        Image(systemName: item.symbolName)
                                            .font(.system(size: 18, weight: .medium))
                                            .foregroundColor(.white)
                                    )
                                    .shadow(color: .accentColor.opacity(0.4), radius: 6, x: 0, y: 2)
                                    .opacity(0.3 + item.temperature * 0.7)
                                    .brightness(item.temperature > 0.8 ? 0.2 : 0)
                                    .scaleEffect(item.temperature > 0.8 ? 1.1 : 1.0)
                                    .animation(.easeInOut(duration: 0.3), value: item.temperature)
                                
                                Text(item.name)
                                    .font(.system(size: 12, weight: .medium, design: .default))
                                    .foregroundStyle(.primary)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.center)
                                    .truncationMode(.tail)
                            }
                            .scaleEffect(hoveredSlot == slotIndex ? 1.05 : 1.0)
                            .animation(.easeInOut(duration: 0.15), value: hoveredSlot)
                            .onTapGesture {
                                touchItem(item)
                            }
                        } else if slotIndex == numberOfSlots - 1 && numberOfSlots < maxSlots {
                            Button(action: addSlot) {
                                Image(systemName: "plus")
                                    .font(.system(size: 20, weight: .medium))
                                    .foregroundColor(.secondary)
                            }
                            .buttonStyle(PlainButtonStyle())
                            .scaleEffect(hoveredSlot == slotIndex ? 1.1 : 1.0)
                            .animation(.easeInOut(duration: 0.15), value: hoveredSlot)
                        }
                        
                        if hoveredSlot == slotIndex && item == nil {
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 2, dash: [5]))
                                .frame(width: 40, height: 40)
                                .opacity(0.6)
                        }
                    }
                    .frame(width: dynamicSlotWidth, height: slotHeight)
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
        .frame(width: Double(numberOfSlots) * dynamicSlotWidth + shelfPadding * 2 + Double(numberOfSlots - 1) * 12, height: slotHeight + 32)
        .onAppear {
            setupSampleItems()
            startAnimationTimer()
        }
        .onDisappear {
            animationTimer?.invalidate()
        }
    }
    
    private func addSlot() {
        if numberOfSlots < maxSlots {
            numberOfSlots += 1
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
        animationTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { _ in
            for i in items.indices {
                items[i].temperature = max(0.2, items[i].temperature - 0.15)
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
                            
                            while items.count <= slotIndex {
                                items.append(ShelfItem(name: "Empty"))
                            }
                            
                            if slotIndex < items.count {
                                items[slotIndex] = newItem
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