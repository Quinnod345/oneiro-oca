struct ContentView: View {
    @State private var shelfItems: [ShelfItem?] = [
        ShelfItem(name: "Report.pdf", type: .file("pdf"), dateAdded: Date().addingTimeInterval(-3600)),
        ShelfItem(name: "Meeting notes", type: .text("Today's standup agenda and key points for discussion"), dateAdded: Date().addingTimeInterval(-7200)),
        nil,
        ShelfItem(name: "Screenshot.png", type: .image("screenshot_data"), dateAdded: Date().addingTimeInterval(-8 * 24 * 60 * 60)),
        nil,
        nil,
        ShelfItem(name: "Budget.xlsx", type: .file("xlsx"), dateAdded: Date().addingTimeInterval(-172800)),
        nil
    ]
    
    var body: some View {
        HStack(spacing: 8) {
            ForEach(0..<8, id: \.self) { index in
                ShelfSlot(
                    item: index < shelfItems.count ? shelfItems[index] : nil,
                    slotIndex: index
                )
            }
        }
        .padding(16)
        .background {
            RoundedRectangle(cornerRadius: 12)
                .fill(.thickMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(.quaternary, lineWidth: 0.5)
                }
        }
        .shadow(color: .black.opacity(0.1), radius: 8, x: 0, y: 2)
    }
}