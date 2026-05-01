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
        .frame(maxWidth: .infinity, maxHeight: 112)
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
            .frame(width: 110, height: 80)
            .overlay(
                Group {
                    if let item = item {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.title)
                                .font(.headline)
                                .foregroundColor(isOld(item) ? .secondary : .primary)
                                .lineLimit(1)
                            
                            Text(item.preview)
                                .font(.subheadline)
                                .foregroundColor(isOld(item) ? .secondary : .secondary)
                                .lineLimit(2)
                        }
                        .padding(8)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .opacity(isOld(item) ? 0.6 : 1.0)
                    } else {
                        EmptySlotView()
                    }
                }
            )
    }
    
    private func isOld(_ item: ShelfItem) -> Bool {
        Date().timeIntervalSince(item.dateAdded) > 518400
    }
}

struct EmptySlotView: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 4)
            .stroke(.tertiary, lineWidth: 1, dashPattern: [4, 4])
            .frame(width: 60, height: 40)
    }
}