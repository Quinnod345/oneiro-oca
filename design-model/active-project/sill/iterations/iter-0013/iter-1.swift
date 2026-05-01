struct ContentView: View {
    @StateObject private var store: ShelfStore = ShelfStore()
    
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Sill")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.primary)
                
                Spacer()
                
                Text("\(store.items.count)/8")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.regularMaterial)
            
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 4), spacing: 6) {
                ForEach(0..<8, id: \.self) { index in
                    SlotView(
                        item: index < store.items.count ? store.items[index] : nil,
                        index: index,
                        onDrop: { item in
                            store.addItem(item)
                        },
                        onRemove: { item in
                            store.removeItem(item)
                        }
                    )
                }
            }
            .padding(12)
            .background(.thickMaterial)
        }
        .background(.ultraThinMaterial)
        .frame(width: 320, height: 180)
        .cornerRadius(8)
    }
}