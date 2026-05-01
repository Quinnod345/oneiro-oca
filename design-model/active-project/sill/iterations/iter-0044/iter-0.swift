struct ContentView: View {
    @State private var items: [ShelfItem] = []
    @State private var draggedItem: ShelfItem?
    @State private var hoveredSlot: Int?
    @State private var animationTimer: Timer?
    @State private var grainPhase: Double = 0.0
    
    let maxSlots: Int = 8
    let slotWidth: Double = 160.0
    let slotHeight: Double = 80.0
    let shelfPadding: Double = 20.0
    
    var body: some View {
        ZStack {
            // Base shelf surface
            Rectangle()
                .fill(
                    LinearGradient(
                        stops: [
                            .init(color: Color(red: 0.25, green: 0.18, blue: 0.12), location: 0),
                            .init(color: Color(red: 0.32, green: 0.24, blue: 0.18), location: 0.5),
                            .init(color: Color(red: 0.28, green: 0.20, blue: 0.14), location: 1)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .overlay(
                    // Ambient glow
                    LinearGradient(
                        stops: [
                            .init(color: Color(red: 1.0, green: 0.7, blue: 0.3).opacity(0.15), location: 0),
                            .init(color: Color.clear, location: 1)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .overlay(
                    // Grain texture
                    GrainLayer(intensity: 0.08 + sin(grainPhase) * 0.02)
                        .blendMode(.overlay)
                )
            
            // Item slots
            HStack(spacing: 4) {
                ForEach(0..<maxSlots, id: \.self) { slotIndex in
                    let item = items.first { item in
                        items.firstIndex { $0.id == item.id } == slotIndex
                    }
                    
                    ZStack {
                        // Slot indicator
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(
                                Color(red: 0.4, green: 0.3, blue: 0.2).opacity(0.4),
                                lineWidth: hoveredSlot == slotIndex ? 2.0 : 1.0
                            )
                            .fill(
                                RadialGradient(
                                    colors: [
                                        Color(red: 0.35, green: 0.26, blue: 0.19).opacity(0.3),
                                        Color.clear
                                    ],
                                    center: .center,
                                    startRadius: 20,
                                    endRadius: 60
                                )
                            )
                            .animation(.easeInOut(duration: 0.2), value: hoveredSlot)
                        
                        // Item if present
                        if let item = item {
                            VStack(spacing: 4) {
                                Circle()
                                    .fill(
                                        RadialGradient(
                                            colors: [
                                                item.warmth.opacity(0.9),
                                                item.warmth.opacity(0.6),
                                                item.warmth.opacity(0.3)
                                            ],
                                            center: .center,
                                            startRadius: 5,
                                            endRadius: 25
                                        )
                                    )
                                    .frame(width: 40, height: 40)
                                    .overlay(
                                        Circle()
                                            .stroke(item.warmth.opacity(0.8), lineWidth: 1.5)
                                            .blur(radius: 0.5)
                                    )
                                    .shadow(
                                        color: item.warmth.opacity(0.6),
                                        radius: item.temperature * 8,
                                        x: 0,
                                        y: 2
                                    )
                                
                                Text(item.name)
                                    .font(.system(size: 11, weight: .medium, design: .rounded))
                                    .foregroundColor(item.warmth.opacity(0.9))
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                            }
                            .scaleEffect(item.temperature * 0.3 + 0.7)
                            .animation(
                                .spring(response: 0.6, dampingFraction: 0.8),
                                value: item.temperature
                            )
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
        .frame(width: Double(maxSlots) * slotWidth + shelfPadding * 2, height: 120)
        .onAppear {
            startAnimationTimer()
            
            // Add some sample items
            addItem(name: "Notes")
            addItem(name: "Calculator") 
            addItem(name: "Terminal")
        }
        .onDisappear {
            stopAnimationTimer()
        }
    }
    
    private func addItem(name: String) {
        if items.count < maxSlots {
            let newItem = ShelfItem(name: name)
            items.append(newItem)
        }
    }
    
    private func touchItem(_ item: ShelfItem) {
        if let index = items.firstIndex(where: { $0.id == item.id }) {
            items[index].lastTouched = Date()
        }
    }
    
    private func handleDrop(providers: [NSItemProvider], slotIndex: Int) -> Bool {
        defer { hoveredSlot = nil }
        
        guard let provider = providers.first else { return false }
        
        _ = provider.loadObject(ofClass: NSString.self) { object, _ in
            DispatchQueue.main.async {
                if let string = object as? String {
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
    
    private func startAnimationTimer() {
        animationTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
            grainPhase += 0.02
            
            // Force view updates for thermal decay
            if !items.isEmpty {
                let randomIndex = Int.random(in: 0..<items.count)
                let item = items[randomIndex]
                if item.thermalAge > 0.01 {
                    items[randomIndex] = item
                }
            }
        }
    }
    
    private func stopAnimationTimer() {
        animationTimer?.invalidate()
        animationTimer = nil
    }
}