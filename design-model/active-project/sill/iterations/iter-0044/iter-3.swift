struct ContentView: View {
    @State private var items: [ShelfItem] = []
    @State private var draggedItem: ShelfItem?
    @State private var hoveredSlot: Int?
    @State private var numberOfSlots: Int = 4
    
    let maxSlots: Int = 8
    let slotHeight: Double = 96.0
    let shelfPadding: Double = 16.0
    
    private var slotWidth: Double {
        return 120.0
    }
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(.regularMaterial)
                .shadow(color: .black.opacity(0.15), radius: 8, x: 0, y: 4)
            
            HStack(spacing: 16) {
                ForEach(0..<numberOfSlots, id: \.self) { slotIndex in
                    let item = items.indices.contains(slotIndex) ? items[slotIndex] : nil
                    
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(
                                hoveredSlot == slotIndex ? 
                                Color.accentColor.opacity(0.05) : 
                                Color.clear
                            )
                            .stroke(
                                Color.primary.opacity(0.12),
                                lineWidth: 1
                            )
                            .animation(.easeOut(duration: 0.1), value: hoveredSlot)
                        
                        if let item = item {
                            VStack(spacing: 8) {
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(Color.accentColor)
                                    .frame(width: 32, height: 32)
                                    .overlay(
                                        Image(systemName: item.symbolName)
                                            .font(.system(size: 16, weight: .medium))
                                            .foregroundColor(.white)
                                    )
                                    .shadow(color: .black.opacity(0.1), radius: 2, x: 0, y: 1)
                                
                                Text(item.name)
                                    .font(.system(size: 13, weight: .medium, design: .default))
                                    .foregroundStyle(.primary)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.center)
                                    .truncationMode(.tail)
                                    .frame(maxWidth: slotWidth - 16)
                            }
                            .onTapGesture {
                                touchItem(item)
                            }
                        } else if slotIndex == numberOfSlots - 1 && numberOfSlots < maxSlots {
                            Button(action: addSlot) {
                                Image(systemName: "plus")
                                    .font(.system(size: 18, weight: .medium))
                                    .foregroundColor(.secondary)
                            }
                            .buttonStyle(PlainButtonStyle())
                        }
                    }
                    .frame(width: slotWidth, height: slotHeight)
                    .contentShape(Rectangle())
                    .onHover { isHovering in
                        hoveredSlot = isHovering ? slotIndex : nil
                    }
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
        .frame(width: Double(numberOfSlots) * slotWidth + shelfPadding * 2 + Double(numberOfSlots - 1) * 16, height: slotHeight + 24)
        .onAppear {
            setupSampleItems()
        }
    }
    
    private func addSlot() {
        if numberOfSlots < maxSlots {
            numberOfSlots += 1
        }
    }
    
    private func setupSampleItems() {
        items = [
            ShelfItem(name: "Documents", symbolName: "doc.fill"),
            ShelfItem(name: "Pictures", symbolName: "photo.fill"),
            ShelfItem(name: "Downloads", symbolName: "arrow.down.circle.fill")
        ]
    }
    
    private func touchItem(_ item: ShelfItem) {
        // Handle item interaction
    }
    
    private func handleDrop(providers: [NSItemProvider], slotIndex: Int) -> Bool {
        return false
    }
}