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
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 16) {
                    ForEach(0..<8, id: \.self) { index in
                        ShelfSlot(
                            item: shelfItems[index], 
                            slotIndex: index,
                            onEmptyTap: { addNewItem(at: index) }
                        )
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
        }
        .background(nativeBackground)
        .frame(maxWidth: .infinity, idealHeight: 140)
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
    
    private func addNewItem(at index: Int) {
        withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
            shelfItems[index] = ShelfItem(
                title: "New Item",
                dateAdded: Date(),
                preview: "Tap to edit this item"
            )
        }
    }
}

struct ShelfSlot: View {
    let item: ShelfItem?
    let slotIndex: Int
    let onEmptyTap: () -> Void
    
    @State private var isHovering = false
    @State private var isPressed = false
    
    var body: some View {
        RoundedRectangle(cornerRadius: 10)
            .fill(item?.isOld == true ? .ultraThinMaterial : .secondarySystemFill)
            .frame(width: 140, height: 100)
            .scaleEffect(isHovering || isPressed ? 1.05 : 1.0)
            .opacity(item?.isOld == true ? 0.6 : 1.0)
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
                                .multilineTextAlignment(.leading)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    } else {
                        EmptySlotView()
                    }
                }
            )
            .onHover { hovering in
                withAnimation(.easeInOut(duration: 0.2)) {
                    isHovering = hovering
                }
            }
            .onTapGesture {
                if item == nil {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
                        isPressed = true
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
                            isPressed = false
                        }
                        onEmptyTap()
                    }
                }
            }
            .contextMenu {
                if item != nil {
                    Button("Remove", role: .destructive) { }
                    Button("Duplicate") { }
                    Button("Share") { }
                }
            }
            .animation(.spring(response: 0.4, dampingFraction: 0.8), value: isHovering)
            .animation(.spring(response: 0.3, dampingFraction: 0.6), value: isPressed)
    }
}

struct EmptySlotView: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "plus.circle")
                .font(.system(size: 24, weight: .light))
                .foregroundColor(.quaternary)
            
            Text("Add Item")
                .font(.caption2)
                .foregroundColor(.quaternary)
        }
    }
}