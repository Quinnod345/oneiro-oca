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
            LinenBackground()
            
            VStack(spacing: 40) {
                HStack {
                    Text("Temporal Shelf")
                        .font(.system(size: 24, weight: .light, design: .serif))
                        .foregroundColor(Color(red: 0.4, green: 0.3, blue: 0.2))
                    
                    Spacer()
                    
                    Text("\(items.count)/8")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(Color(red: 0.6, green: 0.5, blue: 0.4))
                }
                .padding(.horizontal, 60)
                .padding(.top, 40)
                
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 30), count: 4), spacing: 30) {
                    ForEach(items) { item in
                        DecayedItemView(item: item)
                            .onTapGesture {
                                openItem(item)
                            }
                    }
                    
                    ForEach(0..<(8 - items.count), id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color(red: 0.8, green: 0.7, blue: 0.6).opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [5, 5]))
                            .frame(width: 80, height: 80)
                            .onTapGesture {
                                addNewItem()
                            }
                    }
                }
                .padding(.horizontal, 60)
                
                Spacer()
                
                HStack(spacing: 20) {
                    Button("Add Item") {
                        addNewItem()
                    }
                    .buttonStyle(PlainButtonStyle())
                    .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
                    
                    Button("Clear Faded") {
                        clearFadedItems()
                    }
                    .buttonStyle(PlainButtonStyle())
                    .foregroundColor(Color(red: 0.7, green: 0.5, blue: 0.4))
                }
                .padding(.bottom, 40)
            }
        }
        .frame(width: 1440, height: 900)
    }
    
    private func addNewItem() {
        guard items.count < 8 else { return }
        
        let types = ShelfItem.ItemType.allCases
        let randomType = types[Int.random(in: 0..<types.count)]
        
        let newItem = ShelfItem(
            title: "New \(randomType.rawValue)",
            createdAt: Date(),
            type: randomType
        )
        
        items.append(newItem)
    }
    
    private func clearFadedItems() {
        items.removeAll { $0.decayState == .fading }
    }
    
    private func openItem(_ item: ShelfItem) {
        // Item interaction would happen here
    }
}