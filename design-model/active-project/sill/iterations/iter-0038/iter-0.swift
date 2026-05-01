struct ContentView: View {
    @State private var clipboardItems: [ClipboardItem] = [
        ClipboardItem(content: "Hello world! This is a test clipboard item with some longer text to see how it wraps.", createdAt: Date().addingTimeInterval(-86400 * 1)),
        ClipboardItem(content: "Another item", createdAt: Date().addingTimeInterval(-86400 * 4)),
        ClipboardItem(content: "Old item that needs attention", createdAt: Date().addingTimeInterval(-86400 * 8)),
        ClipboardItem(content: "Fresh item", createdAt: Date())
    ]
    
    var body: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.95, green: 0.87, blue: 0.73),
                            Color(red: 0.88, green: 0.78, blue: 0.62),
                            Color(red: 0.82, green: 0.7, blue: 0.52)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(height: 200)
                .overlay(
                    VStack {
                        Spacer()
                        Text("Clipboard Shelf")
                            .font(.system(size: 16, weight: .medium, design: .serif))
                            .foregroundColor(Color(red: 0.3, green: 0.2, blue: 0.15))
                            .shadow(
                                color: Color(red: 1.0, green: 0.95, blue: 0.85),
                                radius: 1,
                                x: 0,
                                y: 1
                            )
                        Spacer()
                    }
                )
            
            ZStack {
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(red: 0.52, green: 0.42, blue: 0.32),
                                Color(red: 0.48, green: 0.38, blue: 0.28),
                                Color(red: 0.44, green: 0.34, blue: 0.24)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .frame(height: 90)
                    .shadow(
                        color: Color(red: 0.2, green: 0.15, blue: 0.1),
                        radius: 3,
                        x: 0,
                        y: -2
                    )
                
                HStack(spacing: 12) {
                    ForEach(0..<8, id: \.self) { index in
                        ClipboardSlot(
                            item: index < clipboardItems.count ? clipboardItems[index] : nil,
                            index: index
                        )
                    }
                }
                .padding(.horizontal, 16)
            }
            
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.9, green: 0.82, blue: 0.68),
                            Color(red: 0.85, green: 0.75, blue: 0.6)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(height: 610)
        }
        .frame(width: 1440, height: 900)
        .background(Color(red: 0.95, green: 0.87, blue: 0.73))
    }
}