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
        .background(warmBackground)
        .frame(width: 1016, height: 112)
    }
    
    private var warmBackground: some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(Color(red: 0.97, green: 0.96, blue: 0.94))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color(red: 0.88, green: 0.85, blue: 0.82), lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.15), radius: 12, x: 0, y: 6)
            .shadow(color: Color.black.opacity(0.25), radius: 2, x: 0, y: 1)
    }
}