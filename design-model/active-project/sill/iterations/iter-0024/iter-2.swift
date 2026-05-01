struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(name: "Notes", age: 300, icon: "note.text"),
        ShelfItem(name: "Photos", age: 600, icon: "photo"),
        ShelfItem(name: "Music", age: 1800, icon: "music.note"),
        ShelfItem(name: "Mail", age: 2400, icon: "envelope"),
        ShelfItem(name: "Calendar", age: 3200, icon: "calendar")
    ]
    
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                ForEach(items) { item in
                    SlotView(item: item)
                }
                
                ForEach(0..<(8 - items.count), id: \.self) { _ in
                    EmptySlotView()
                }
            }
            .padding(8)
        }
        .frame(width: 720, height: 140)
        .background(.regularMaterial)
    }
}

struct SlotView: View {
    let item: ShelfItem
    
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: item.icon)
                .font(.system(size: 24))
                .foregroundStyle(.primary)
                .opacity(item.opacity)
                .scaleEffect(item.scale)
                .blur(radius: item.blur)
            
            Text(item.name)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
                .opacity(item.opacity * 0.8)
                .blur(radius: item.blur * 0.5)
        }
        .frame(width: item.slotSize, height: item.slotSize)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(.thinMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(item.colorTemperature.opacity(0.1))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(.quaternary, lineWidth: 0.5)
                )
        )
        .shadow(color: .black.opacity(0.1), radius: 2, y: 1)
        .scaleEffect(item.scale)
        .animation(.spring(response: 0.6, dampingFraction: 0.8), value: item.scale)
    }
}

struct EmptySlotView: View {
    var body: some View {
        Rectangle()
            .fill(.clear)
            .frame(width: 80, height: 80)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(.ultraThinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(.tertiary, lineWidth: 0.5)
                    )
            )
            .opacity(0.4)
    }
}