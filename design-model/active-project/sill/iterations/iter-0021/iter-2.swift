struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(title: "Project Notes", createdAt: Calendar.current.date(byAdding: .day, value: -1, to: Date()) ?? Date(), type: .note),
        ShelfItem(title: "Design Mockup", createdAt: Calendar.current.date(byAdding: .day, value: -4, to: Date()) ?? Date(), type: .image),
        ShelfItem(title: "Meeting Documentation", createdAt: Calendar.current.date(byAdding: .day, value: -6, to: Date()) ?? Date(), type: .document),
        ShelfItem(title: "Reference Link", createdAt: Calendar.current.date(byAdding: .day, value: -8, to: Date()) ?? Date(), type: .link),
        ShelfItem(title: "Todo List", createdAt: Calendar.current.date(byAdding: .day, value: -3, to: Date()) ?? Date(), type: .note)
    ]
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
                .ignoresSafeArea()
            
            VStack(spacing: 48) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Temporal Shelf")
                            .font(.system(.title, design: .default, weight: .semibold))
                            .foregroundStyle(.primary)
                        
                        Text("Items fade with time")
                            .font(.system(.subheadline, design: .default, weight: .regular))
                            .foregroundStyle(.secondary)
                    }
                    
                    Spacer()
                    
                    VStack(alignment: .trailing, spacing: 4) {
                        Text("\(items.count)/8")
                            .font(.system(.title3, design: .monospaced, weight: .medium))
                            .foregroundStyle(.primary)
                        
                        Text("capacity")
                            .font(.system(.caption, design: .default, weight: .regular))
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                }
                .padding(.horizontal, 48)
                .padding(.top, 32)
                
                LazyVGrid(columns: adaptiveColumns, spacing: 48) {
                    ForEach(sortedItems) { item in
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
                .padding(.horizontal, 48)
                .animation(.spring(response: 0.8, dampingFraction: 0.8), value: items.count)
                
                Spacer()
                
                HStack(spacing: 20) {
                    Button("Add Item") {
                        addNewItem()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(items.count >= 8)
                    
                    Button("Clear Faded") {
                        clearFadedItems()
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .disabled(!hasFadedItems)
                }
                .padding(.bottom, 32)
            }
        }
        .frame(minWidth: 600, idealWidth: 800, minHeight: 500, idealHeight: 700)
    }
    
    private var adaptiveColumns: [GridItem] {
        [GridItem(.adaptive(minimum: 160, maximum: 200), spacing: 48)]
    }
    
    private var sortedItems: [ShelfItem] {
        items.sorted { first, second in
            let firstPriority = decayPriority(for: first.decayState)
            let secondPriority = decayPriority(for: second.decayState)
            
            if firstPriority != secondPriority {
                return firstPriority < secondPriority
            }
            
            return first.createdAt > second.createdAt
        }
    }
    
    private func decayPriority(for state: ShelfItem.DecayState) -> Int {
        switch state {
        case .fresh: return 0
        case .aging: return 1
        case .fading: return 2
        }
    }
    
    private var hasFadedItems: Bool {
        items.contains { $0.decayState == .fading }
    }
    
    private func addNewItem() {
        guard items.count < 8 else { return }
        
        withAnimation(.spring(response: 0.8, dampingFraction: 0.8)) {
            let types = ShelfItem.ItemType.allCases
            let randomType = types[Int.random(in: 0..<types.count)]
            
            let titles = [
                "Meeting Notes", "Design Draft", "Research Link", "Task List",
                "Project Brief", "Reference Doc", "Quick Idea", "Code Snippet"
            ]
            
            let newItem = ShelfItem(
                title: titles.randomElement() ?? "New Item",
                createdAt: Date(),
                type: randomType
            )
            
            items.append(newItem)
        }
    }
    
    private func clearFadedItems() {
        withAnimation(.spring(response: 0.8, dampingFraction: 0.8)) {
            items.removeAll { $0.decayState == .fading }
        }
    }
    
    private func openItem(_ item: ShelfItem) {
        
    }
}

struct EmptySlotView: View {
    let action: () -> Void
    @State private var isHovered = false
    
    var body: some View {
        VStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 16)
                .stroke(.tertiary, style: StrokeStyle(lineWidth: 2, dash: [12, 6]))
                .frame(height: 120)
                .overlay(
                    VStack(spacing: 8) {
                        Image(systemName: "plus.circle")
                            .font(.system(size: 32, weight: .light))
                            .foregroundStyle(.tertiary)
                        
                        Text("Add Item")
                            .font(.system(.caption, design: .default, weight: .medium))
                            .foregroundStyle(.tertiary)
                    }
                    .opacity(isHovered ? 1.0 : 0.6)
                )
                .scaleEffect(isHovered ? 1.05 : 1.0)
                .onTapGesture {
                    action()
                }
            
            Text("Empty Slot")
                .font(.system(.caption2, design: .default, weight: .regular))
                .foregroundStyle(.quaternary)
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