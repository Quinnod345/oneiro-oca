struct ContentView: View {
    @StateObject private var store = ShelfStore()
    
    private let columns = Array(repeating: GridItem(.fixed(60), spacing: 12), count: 4)
    
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Sill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.primary)
                
                Spacer()
                
                Text("\(store.items.count)/8")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(.quaternary, in: Capsule())
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(
                LinearGradient(
                    colors: [
                        Color.white.opacity(0.9),
                        Color.white.opacity(0.7)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .background(.regularMaterial)
            )
            
            Divider()
                .opacity(0.2)
            
            LazyVGrid(columns: columns, spacing: 12) {
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
            .padding(20)
            .background(
                LinearGradient(
                    colors: [
                        Color.black.opacity(0.02),
                        Color.black.opacity(0.05)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .background(.regularMaterial)
            )
        }
        .frame(width: 340, height: 200)
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.15), radius: 20, x: 0, y: 10)
        .shadow(color: .black.opacity(0.05), radius: 2, x: 0, y: 1)
    }
}