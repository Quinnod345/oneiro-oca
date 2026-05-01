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
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 16) {
                ForEach(0..<shelfItems.count, id: \.self) { index in
                    ShelfSlot(item: shelfItems[index], slotIndex: index)
                        .frame(width: 80)
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 20)
            .padding(.bottom, 16)
            
            Rectangle()
                .fill(.quaternary)
                .frame(height: 8)
                .overlay {
                    LinearGradient(
                        colors: [.clear, .black.opacity(0.1), .clear],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                }
        }
        .background {
            RoundedRectangle(cornerRadius: 16)
                .fill(.thickMaterial)
                .overlay(alignment: .bottom) {
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(.quaternary, lineWidth: 0.5)
                }
        }
        .shadow(color: .black.opacity(0.08), radius: 16, x: 0, y: 8)
    }
}