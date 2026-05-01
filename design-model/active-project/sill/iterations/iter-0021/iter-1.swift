struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(title: "Project Notes", createdAt: Calendar.current.date(byAdding: .day, value: -1, to: Date()) ?? Date(), type: .note),
        ShelfItem(title: "Design Mockup", createdAt: Calendar.current.date(byAdding: .day, value: -4, to: Date()) ?? Date(), type: .image),
        ShelfItem(title: "Meeting Doc", createdAt: Calendar.current.date(byAdding: .day, value: -6, to: Date()) ?? Date(), type: .document),
        ShelfItem(title: "Reference Link", createdAt: Calendar.current.date(byAdding: .day, value: -8, to: Date()) ?? Date(), type: .link),
        ShelfItem(title: "Todo List", createdAt: Calendar.current.date(byAdding: .day, value: -3, to: Date()) ?? Date(), type: .note)
    ]
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
                .ignoresSafeArea()
            
            VStack(spacing: 32) {
                HStack {
                    Text("Temporal Shelf")
                        .font(.system(.title2, design: .default, weight: .medium))
                        .foregroundStyle(.primary)
                    
                    Spacer()
                    
                    Text("\(items.count)/8")
                        .font(.system(.subheadline, design: .default, weight: .medium))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 6))
                }
                .padding(.horizontal, 40)
                .padding(.top, 20)
                
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 24), count: 4), spacing: 24) {
                    ForEach(items) { item in
                        DecayedItemView(item: item)
                            .onTapGesture {
                                openItem(item)
                            }
                    }
                    
                    ForEach(0..<(8 - items.count), id: \.self) { _ in
                        EmptySlotView {
                            addNewItem()
                        }
                    }
                }
                .padding(.horizontal, 40)
                .animation(.spring(response: 0.6, dampingFraction: 0.8), value: items.count)
                
                Spacer()
                
                HStack(spacing: 16) {
                    Button("Add Item") {
                        addNewItem()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.regular)
                    
                    Button("Clear Faded") {
                        clearFadedItems()
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.regular)
                }
                .padding(.bottom, 20)
            }
        }
        .frame(minWidth: 600, idealWidth: 800, minHeight: 500, idealHeight: 700)
    }
    
    private func addNewItem() {
        guard items.count < 8 else { return }
        
        withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
            let types = ShelfItem.ItemType.allCases
            let randomType = types[Int.random(in: 0..<types.count)]
            
            let newItem = ShelfItem(
                title: "New \(randomType.rawValue)",
                createdAt: Date(),
                type: randomType
            )
            
            items.append(newItem)
        }
    }
    
    private func clearFadedItems() {
        withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
            items.removeAll { $0.decayState == .fading }
        }
    }
    
    private func openItem(_ item: ShelfItem) {
        // Item interaction would happen here
    }
}

struct EmptySlotView: View {
    let action: () -> Void
    @State private var isHovered = false
    
    var body: some View {
        VStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 12)
                .stroke(.tertiary, style: StrokeStyle(lineWidth: 2, dash: [8, 4]))
                .frame(width: 80, height: 80)
                .overlay(
                    Image(systemName: "plus")
                        .font(.title3)
                        .foregroundStyle(.tertiary)
                        .opacity(isHovered ? 1.0 : 0.6)
                )
                .scaleEffect(isHovered ? 1.05 : 1.0)
                .onTapGesture {
                    action()
                }
            
            Text("Empty")
                .font(.system(.caption, design: .default, weight: .medium))
                .foregroundStyle(.tertiary)
                .opacity(isHovered ? 1.0 : 0.6)
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: isHovered)
        .onHover { hovering in
            isHovered = hovering
        }
    }
}

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = blendingMode
        view.state = .active
        return view
    }
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}