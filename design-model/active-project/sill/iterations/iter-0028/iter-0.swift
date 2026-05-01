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
        HStack(spacing: 12) {
            ForEach(0..<8, id: \.self) { index in
                ShelfSlot(
                    item: index < shelfItems.count ? shelfItems[index] : nil,
                    slotIndex: index
                )
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.85, green: 0.72, blue: 0.58),
                            Color(red: 0.78, green: 0.65, blue: 0.52)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.92, green: 0.82, blue: 0.70),
                                    Color(red: 0.70, green: 0.58, blue: 0.45)
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            ),
                            lineWidth: 1
                        )
                )
                .shadow(color: Color.black.opacity(0.15), radius: 8, x: 0, y: 4)
        )
        .frame(width: 680, height: 100)
    }
}