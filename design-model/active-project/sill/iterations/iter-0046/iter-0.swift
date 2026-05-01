struct ContentView: View {
    @State private var items: [ShelfItem] = []
    @State private var dragOver: Bool = false
    @State private var hoveredSlot: Int? = nil
    
    let maxSlots: Int = 8
    let slotSize: CGSize = CGSize(width: 140, height: 100)
    let shelfPadding: Double = 24
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Deep wood windowsill background
                LinearGradient(
                    colors: [
                        Color(red: 0.35, green: 0.25, blue: 0.18),
                        Color(red: 0.28, green: 0.20, blue: 0.14),
                        Color(red: 0.32, green: 0.23, blue: 0.16)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()
                
                // Wood grain texture
                WoodGrainCanvas()
                    .opacity(0.3)
                    .ignoresSafeArea()
                
                // Subtle inner shadow for depth
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.black.opacity(0.15),
                                Color.clear,
                                Color.black.opacity(0.08)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .frame(height: 8)
                    .position(x: geometry.size.width / 2, y: 4)
                
                // Main shelf content
                HStack(spacing: 16) {
                    ForEach(0..<maxSlots, id: \.self) { index in
                        ZStack {
                            // Slot background with warm material
                            RoundedRectangle(cornerRadius: 12)
                                .fill(
                                    Color(red: 0.92, green: 0.88, blue: 0.82)
                                        .opacity(items.count > index ? 0.95 : 0.4)
                                )
                                .shadow(
                                    color: Color.black.opacity(0.25),
                                    radius: items.count > index ? 3 : 1,
                                    x: 0,
                                    y: items.count > index ? 2 : 1
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(
                                            Color(red: 0.40, green: 0.30, blue: 0.22).opacity(0.3),
                                            lineWidth: 0.5
                                        )
                                )
                            
                            if items.count > index {
                                let item = items[index]
                                
                                VStack(spacing: 8) {
                                    // Item type indicator
                                    Image(systemName: iconForType(item.type))
                                        .font(.system(size: 20, weight: .medium))
                                        .foregroundColor(
                                            Color(red: 0.45, green: 0.35, blue: 0.25)
                                                .blendMode(.multiply)
                                        )
                                    
                                    // Content preview
                                    Text(item.content)
                                        .font(.system(size: 11, weight: .regular))
                                        .foregroundColor(
                                            Color(red: 0.25, green: 0.20, blue: 0.15)
                                        )
                                        .lineLimit(3)
                                        .multilineTextAlignment(.center)
                                        .padding(.horizontal, 8)
                                }
                                .colorMultiply(item.warmthTint)
                                .saturation(item.saturation)
                                .opacity(item.opacity)
                                
                                // Age ring around the slot
                                AgeRing(progress: item.decayProgress)
                                    .frame(width: slotSize.width + 8, height: slotSize.height + 8)
                            }
                        }
                        .frame(width: slotSize.width, height: slotSize.height)
                        .scaleEffect(hoveredSlot == index ? 1.05 : 1.0)
                        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: hoveredSlot)
                        .onHover { isHovering in
                            hoveredSlot = isHovering ? index : nil
                        }
                        .onDrop(of: ["public.text", "public.url"], isTargeted: nil) { providers in
                            handleDrop(providers: providers, at: index)
                        }
                    }
                }
                .padding(.horizontal, shelfPadding)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            startDecayTimer()
        }
    }
    
    private func iconForType(_ type: ShelfItem.ItemType) -> String {
        switch type {
        case .text: return "doc.text"
        case .url: return "link"
        case .image: return "photo"
        case .file: return "doc"
        }
    }
    
    private func handleDrop(providers: [NSItemProvider], at index: Int) -> Bool {
        guard let provider = providers.first else { return false }
        
        if provider.hasItemConformingToTypeIdentifier("public.url") {
            provider.loadItem(forTypeIdentifier: "public.url", options: nil) { data, _ in
                if let url = data as? URL {
                    DispatchQueue.main.async {
                        addOrReplaceItem(
                            content: url.absoluteString,
                            type: .url,
                            at: index
                        )
                    }
                }
            }
            return true
        } else if provider.hasItemConformingToTypeIdentifier("public.text") {
            provider.loadItem(forTypeIdentifier: "public.text", options: nil) { data, _ in
                if let text = data as? String {
                    DispatchQueue.main.async {
                        addOrReplaceItem(
                            content: text,
                            type: .text,
                            at: index
                        )
                    }
                }
            }
            return true
        }
        
        return false
    }
    
    private func addOrReplaceItem(content: String, type: ShelfItem.ItemType, at index: Int) {
        let newItem = ShelfItem(
            content: String(content.prefix(100)),
            addedDate: Date(),
            type: type
        )
        
        if index < items.count {
            items[index] = newItem
        } else {
            while items.count < index {
                items.append(ShelfItem(content: "", addedDate: Date(), type: .text))
            }
            items.append(newItem)
        }
    }
    
    private func startDecayTimer() {
        Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { _ in
            // Remove items older than 7 days
            items.removeAll { $0.ageInDays >= 7.0 }
        }
    }
}