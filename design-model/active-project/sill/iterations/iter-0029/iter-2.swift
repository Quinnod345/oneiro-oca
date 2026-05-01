struct ContentView: View {
    @State private var shelfItems: [ShelfItem?] = [
        ShelfItem(title: "Design Notes", dateAdded: Date().addingTimeInterval(-86400), preview: "Color palette thoughts for the new interface design"),
        ShelfItem(title: "Meeting Recap", dateAdded: Date().addingTimeInterval(-172800), preview: "Key decisions from today's sync"),
        nil,
        nil,
        ShelfItem(title: "Old Reference", dateAdded: Date().addingTimeInterval(-604800), preview: "This should appear faded"),
        nil,
        nil,
        nil
    ]
    
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                ForEach(0..<8, id: \.self) { index in
                    ShelfSlot(item: shelfItems[index], slotIndex: index)
                }
            }
            .padding(16)
        }
        .background(nativeBackground)
        .frame(maxWidth: .infinity, maxHeight: 132)
    }
    
    private var nativeBackground: some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(.regularMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(.separator, lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.1), radius: 2)
    }
}

struct ShelfSlot: View {
    let item: ShelfItem?
    let slotIndex: Int
    
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(.secondarySystemFill)
            .frame(width: 140, height: 100)
            .overlay(
                Group {
                    if let item = item {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.title)
                                .font(.callout)
                                .fontWeight(.medium)
                                .foregroundColor(.primary)
                                .lineLimit(1)
                            
                            Text(item.preview)
                                .font(.caption)
                                .fontWeight(.regular)
                                .foregroundColor(.secondary)
                                .lineLimit(3)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    } else {
                        EmptySlotView()
                    }
                }
            )
    }
}

struct EmptySlotView: View {
    var body: some View {
        Image(systemName: "plus")
            .font(.system(size: 20, weight: .light))
            .foregroundColor(.quaternary)
    }
}