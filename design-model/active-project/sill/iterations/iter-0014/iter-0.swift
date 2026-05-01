struct ContentView: View {
    @State private var shelfItems: [ShelfItem] = [
        ShelfItem(name: "Notes", type: .document, preview: "Meeting notes from...", daysOld: 2),
        ShelfItem(name: "Design", type: .image, preview: "Wireframes and mockups", daysOld: 1),
        ShelfItem(name: "Code", type: .code, preview: "SwiftUI components", daysOld: 0),
        ShelfItem(name: "Brief", type: .pdf, preview: "Project requirements", daysOld: 5),
        ShelfItem(name: "Demo", type: .video, preview: "Screen recording", daysOld: 6),
        ShelfItem(isEmpty: true),
        ShelfItem(isEmpty: true),
        ShelfItem(isEmpty: true)
    ]
    
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.2, green: 0.15, blue: 0.1),
                    Color(red: 0.15, green: 0.12, blue: 0.08)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            
            VStack {
                Spacer()
                
                HStack(spacing: 12) {
                    ForEach(Array(shelfItems.enumerated()), id: \.element.id) { index, item in
                        ShelfSlot(item: item, slotIndex: index)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.35, green: 0.22, blue: 0.14),
                                    Color(red: 0.25, green: 0.16, blue: 0.1)
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color(red: 0.45, green: 0.32, blue: 0.2), lineWidth: 1)
                        )
                )
                
                Spacer()
            }
        }
        .frame(width: 1440, height: 900)
    }
}