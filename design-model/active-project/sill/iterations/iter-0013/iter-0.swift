struct ContentView: View {
    @StateObject private var store: ShelfStore = ShelfStore()
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Sill")
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundColor(Color(red: 0.9, green: 0.8, blue: 0.6))
                
                Spacer()
                
                Text("\(store.items.count)/8")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundColor(Color(red: 0.7, green: 0.6, blue: 0.4))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(
                LinearGradient(
                    colors: [
                        Color(red: 0.45, green: 0.25, blue: 0.10),
                        Color(red: 0.35, green: 0.20, blue: 0.08)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            
            // Shelf grid
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
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
            .padding(16)
            .background(
                LinearGradient(
                    colors: [
                        Color(red: 0.55, green: 0.35, blue: 0.15),
                        Color(red: 0.65, green: 0.45, blue: 0.25),
                        Color(red: 0.55, green: 0.35, blue: 0.15)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .overlay(
                    // Subtle grain texture
                    Rectangle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    Color.clear,
                                    Color.black.opacity(0.05),
                                    Color.clear
                                ],
                                center: .center,
                                startRadius: 10,
                                endRadius: 100
                            )
                        )
                        .blendMode(.overlay)
                )
            )
        }
        .background(Color(red: 0.35, green: 0.20, blue: 0.08))
        .frame(width: 400, height: 240)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(color: Color.black.opacity(0.4), radius: 8, x: 0, y: 4)
    }
}