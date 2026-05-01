struct ContentView: View {
    @State private var items: [ShelfItem] = []
    @State private var draggedItem: ShelfItem?
    @State private var dragOffset: CGSize = .zero
    @State private var hoveredSlot: Int? = nil
    @State private var showingDropZones: Bool = false
    @State private var woodGrainOffset: Double = 0
    @State private var settleAnimations: Set<UUID> = []
    
    let maxItems: Int = 8
    let slotWidth: CGFloat = 160
    let slotHeight: CGFloat = 120
    let shelfHeight: CGFloat = 200
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Background
                Color(red: 0.12, green: 0.10, blue: 0.08)
                    .ignoresSafeArea()
                
                // Wooden shelf
                VStack {
                    Spacer()
                    
                    // Shelf surface
                    ZStack {
                        // Base wood color
                        RoundedRectangle(cornerRadius: 8)
                            .fill(
                                LinearGradient(
                                    stops: [
                                        .init(color: Color(red: 0.55, green: 0.35, blue: 0.20), location: 0),
                                        .init(color: Color(red: 0.48, green: 0.30, blue: 0.18), location: 0.3),
                                        .init(color: Color(red: 0.52, green: 0.33, blue: 0.19), location: 0.7),
                                        .init(color: Color(red: 0.45, green: 0.28, blue: 0.16), location: 1)
                                    ],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                            )
                        
                        // Wood grain texture
                        RoundedRectangle(cornerRadius: 8)
                            .fill(
                                LinearGradient(
                                    stops: [
                                        .init(color: Color(red: 0.60, green: 0.38, blue: 0.22).opacity(0.8), location: 0.1 + sin(woodGrainOffset) * 0.05),
                                        .init(color: Color(red: 0.42, green: 0.26, blue: 0.15).opacity(0.9), location: 0.15 + sin(woodGrainOffset + 1) * 0.03),
                                        .init(color: Color(red: 0.58, green: 0.36, blue: 0.21).opacity(0.7), location: 0.3 + sin(woodGrainOffset + 2) * 0.04),
                                        .init(color: Color(red: 0.44, green: 0.27, blue: 0.16).opacity(0.8), location: 0.5 + sin(woodGrainOffset + 3) * 0.06),
                                        .init(color: Color(red: 0.56, green: 0.34, blue: 0.20).opacity(0.9), location: 0.7 + sin(woodGrainOffset + 4) * 0.03),
                                        .init(color: Color(red: 0.40, green: 0.24, blue: 0.14).opacity(0.8), location: 0.9 + sin(woodGrainOffset + 5) * 0.02)
                                    ],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .blendMode(.multiply)
                        
                        // Subtle highlight
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(
                                LinearGradient(
                                    colors: [
                                        Color(red: 0.70, green: 0.50, blue: 0.35).opacity(0.6),
                                        Color(red: 0.35, green: 0.22, blue: 0.13).opacity(0.8)
                                    ],
                                    startPoint: .top,
                                    endPoint: .bottom
                                ),
                                lineWidth: 1
                            )
                        
                        // Item slots
                        HStack(spacing: 12) {
                            ForEach(0..<maxItems, id: \.self) { slotIndex in
                                slotView(for: slotIndex)
                            }
                        }
                        .padding(.horizontal, 32)
                    }
                    .frame(height: shelfHeight)
                    .shadow(color: Color.black.opacity(0.4), radius: 12, x: 0, y: 8)
                    
                    Spacer().frame(height: 40)
                }
            }
        }
        .onAppear {
            startWoodGrainAnimation()
            loadSampleItems()
        }
        .onDrop(of: ["public.text"], isTargeted: $showingDropZones) { providers in
            handleDrop(providers: providers)
        }
    }
    
    private func slotView(for index: Int) -> some View {
        let item = items.first { item in
            let slotX = CGFloat(index) * (slotWidth + 12) + slotWidth / 2
            return abs(item.targetPosition.x - slotX) < slotWidth / 2
        }
        
        return ZStack {
            // Slot base
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(red: 0.38, green: 0.24, blue: 0.14).opacity(0.3))
                .frame(width: slotWidth, height: slotHeight)
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(
                            Color(red: 0.32, green: 0.20, blue: 0.12).opacity(0.5),
                            lineWidth: hoveredSlot == index ? 1.5 : 0.5
                        )
                )
                .scaleEffect(hoveredSlot == index ? 1.02 : 1.0)
                .animation(.easeOut(duration: 0.15), value: hoveredSlot)
            
            // Item content
            if let item = item {
                itemView(item: item)
            }
        }
        .onHover { isHovering in
            hoveredSlot = isHovering ? index : nil
        }
    }
    
    private func itemView(item: ShelfItem) -> some View {
        VStack(spacing: 6) {
            Text(item.title)
                .font(.system(size: 13, weight: .medium, design: .default))
                .foregroundColor(textColor(for: item.decayState))
                .lineLimit(2)
                .multilineTextAlignment(.center)
            
            Text(item.content)
                .font(.system(size: 10, weight: .regular, design: .default))
                .foregroundColor(textColor(for: item.decayState).opacity(0.8))
                .lineLimit(3)
                .multilineTextAlignment(.center)
        }
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(backgroundGradient(for: item.decayState))
                .shadow(
                    color: shadowColor(for: item.decayState),
                    radius: item.decayState == .fresh ? 4 : 2,
                    x: 0,
                    y: settleAnimations.contains(item.id) ? 1 + item.settleOffset : 2
                )
        )
        .offset(y: settleAnimations.contains(item.id) ? item.settleOffset : 0)
        .scaleEffect(draggedItem?.id == item.id ? 1.05 : 1.0)
        .opacity(opacityForDecayState(item.decayState))
        .animation(.easeOut(duration: 0.8), value: item.decayState)
        .onTapGesture {
            activateItem(item)
        }
        .gesture(
            DragGesture()
                .onChanged { value in
                    draggedItem = item
                    dragOffset = value.translation
                }
                .onEnded { _ in
                    handleItemDrop(item: item)
                }
        )
    }
    
    private func textColor(for state: DecayState) -> Color {
        switch state {
        case .fresh:
            return Color(red: 0.95, green: 0.92, blue: 0.88)
        case .amber:
            return Color(red: 0.95, green: 0.85, blue: 0.65)
        case .fading:
            return Color(red: 0.90, green: 0.80, blue: 0.60)
        }
    }
    
    private func backgroundGradient(for state: DecayState) -> LinearGradient {
        switch state {
        case .fresh:
            return LinearGradient(
                colors: [
                    Color(red: 0.25, green: 0.20, blue: 0.16),
                    Color(red: 0.20, green: 0.16, blue: 0.13)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        case .amber:
            return LinearGradient(
                colors: [
                    Color(red: 0.35, green: 0.25, blue: 0.12),
                    Color(red: 0.28, green: 0.20, blue: 0.10)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        case .fading:
            return LinearGradient(
                colors: [
                    Color(red: 0.30, green: 0.22, blue: 0.10).opacity(0.7),
                    Color(red: 0.24, green: 0.18, blue: 0.08).opacity(0.7)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
    }
    
    private func shadowColor(for state: DecayState) -> Color {
        switch state {
        case .fresh:
            return Color.black.opacity(0.3)
        case .amber:
            return Color(red: 0.60, green: 0.35, blue: 0.10).opacity(0.4)
        case .fading:
            return Color(red: 0.50, green: 0.30, blue: 0.08).opacity(0.2)
        }
    }
    
    private func opacityForDecayState(_ state: DecayState) -> Double {
        switch state {
        case .fresh:
            return 1.0
        case .amber:
            return 0.85
        case .fading:
            return 0.5
        }
    }
    
    private func startWoodGrainAnimation() {
        Timer.scheduledTimer(withTimeInterval: 8.0, repeats: true) { _ in
            withAnimation(.linear(duration: 8.0)) {
                woodGrainOffset += .pi * 2
            }
        }
    }
    
    private func loadSampleItems() {
        let sampleItems = [
            ShelfItem(
                title: "Meeting Notes",
                content: "Q3 planning discussion with team leads",
                addedDate: Calendar.current.date(byAdding: .day, value: -2, to: Date()) ?? Date(),
                position: CGPoint(x: slotWidth / 2, y: 0),
                targetPosition: CGPoint(x: slotWidth / 2, y: 0)
            ),
            ShelfItem(
                title: "Design Mockups",
                content: "Updated wireframes for the dashboard redesign",
                addedDate: Calendar.current.date(byAdding: .day, value: -6, to: Date()) ?? Date(),
                position: CGPoint(x: slotWidth * 1.5 + 12, y: 0),
                targetPosition: CGPoint(x: slotWidth * 1.5 + 12, y: 0)
            ),
            ShelfItem(
                title: "Research Paper",
                content: "Findings on user interaction patterns",
                addedDate: Calendar.current.date(byAdding: .day, value: -8, to: Date()) ?? Date(),
                position: CGPoint(x: slotWidth * 2.5 + 24, y: 0),
                targetPosition: CGPoint(x: slotWidth * 2.5 + 24, y: 0)
            )
        ]
        items = sampleItems
    }
    
    private func handleDrop(providers: [NSItemProvider]) -> Bool {
        guard items.count < maxItems else { return false }
        
        for provider in providers {
            provider.loadItem(forTypeIdentifier: "public.text", options: nil) { data, error in
                if let data = data as? Data,
                   let text = String(data: data, encoding: .utf8) {
                    DispatchQueue.main.async {
                        addNewItem(content: text)
                    }
                }
            }
        }
        return true
    }
    
    private func addNewItem(content: String) {
        let title = String(content.prefix(30))
        let slotIndex = items.count
        let targetX = CGFloat(slotIndex) * (slotWidth + 12) + slotWidth / 2
        
        let newItem = ShelfItem(
            title: title,
            content: content,
            addedDate: Date(),
            position: CGPoint(x: targetX, y: -slotHeight),
            targetPosition: CGPoint(x: targetX, y: 0),
            isSettling: true
        )
        
        items.append(newItem)
        animateItemSettle(item: newItem)
    }
    
    private func animateItemSettle(item: ShelfItem) {
        settleAnimations.insert(item.id)
        
        withAnimation(.spring(response: 0.5, dampingFraction: 0.7, blendDuration: 0)) {
            if let index = items.firstIndex(where: { $0.id == item.id }) {
                items[index].settleOffset = -8
            }
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.8, blendDuration: 0)) {
                if let index = items.firstIndex(where: { $0.id == item.id }) {
                    items[index].settleOffset = 0
                }
            }
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            settleAnimations.remove(item.id)
        }
    }
    
    private func handleItemDrop(item: ShelfItem) {
        draggedItem = nil
        dragOffset = .zero
        
        // Simple reorder logic would go here
        animateItemSettle(item: item)
    }
    
    private func activateItem(_ item: ShelfItem) {
        // Item activation logic
        withAnimation(.easeOut(duration: 0.2)) {
            // Visual feedback for activation
        }
    }
}