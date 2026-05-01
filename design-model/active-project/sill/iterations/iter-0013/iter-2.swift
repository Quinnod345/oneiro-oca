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
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.regularMaterial)
            
            Divider()
                .opacity(0.3)
            
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    ForEach(0..<3, id: \.self) { index in
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
                
                HStack(spacing: 12) {
                    ForEach(3..<5, id: \.self) { index in
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
                        .frame(width: 52, height: 52)
                    }
                }
                
                HStack(spacing: 8) {
                    ForEach(5..<8, id: \.self) { index in
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
            }
            .padding(16)
            .background(.regularMaterial)
        }
        .frame(width: 320, height: 180)
        .cornerRadius(8)
        .shadow(color: .black.opacity(0.1), radius: 8, x: 0, y: 4)
    }
}