struct ContentView: View {
    @State private var items: [ClipboardItem] = [
        ClipboardItem(content: "Sample text", type: .text, timestamp: Date().addingTimeInterval(-86400)),
        ClipboardItem(content: "https://example.com", type: .link, timestamp: Date().addingTimeInterval(-172800)),
        ClipboardItem(content: "image.png", type: .image, timestamp: Date().addingTimeInterval(-259200)),
        ClipboardItem(content: "func example() {}", type: .code, timestamp: Date().addingTimeInterval(-432000))
    ]
    
    private let slotWidth: Double = 72.0
    private let slotHeight: Double = 80.0
    private let maxSlots: Int = 8
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .popover, blendingMode: .behindWindow)
            
            Color(red: 0.8, green: 0.5, blue: 0.2)
                .opacity(0.15)
            
            HStack(spacing: 8) {
                ForEach(0..<maxSlots, id: \.self) { index in
                    if index < items.count {
                        FilledSlotView(item: items[index], width: slotWidth, height: slotHeight)
                    } else {
                        EmptySlotView(width: slotWidth, height: slotHeight)
                    }
                }
            }
            .padding(16)
        }
        .frame(width: Double(maxSlots) * slotWidth + Double(maxSlots - 1) * 8 + 32, 
               height: slotHeight + 32)
    }
}

struct FilledSlotView: View {
    let item: ClipboardItem
    let width: Double
    let height: Double
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.7, green: 0.4, blue: 0.15),
                            Color(red: 0.6, green: 0.35, blue: 0.12),
                            Color(red: 0.65, green: 0.38, blue: 0.14)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.75, green: 0.45, blue: 0.18).opacity(0.6),
                                    Color.clear,
                                    Color(red: 0.55, green: 0.3, blue: 0.1).opacity(0.3)
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                )
                .shadow(color: Color(red: 0.4, green: 0.25, blue: 0.08).opacity(0.4), 
                       radius: 3, x: 0, y: 2)
            
            Image(systemName: item.type.glyph)
                .font(.system(size: 20, weight: .medium, design: .rounded))
                .foregroundColor(Color(red: 0.95, green: 0.85, blue: 0.6))
        }
        .frame(width: width, height: height)
        .opacity(item.opacity)
    }
}

struct EmptySlotView: View {
    let width: Double
    let height: Double
    
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .strokeBorder(
                style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [4, 4])
            )
            .foregroundColor(Color(red: 0.6, green: 0.35, blue: 0.15).opacity(0.5))
            .frame(width: width, height: height)
    }
}

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = blendingMode
        view.state = .active
        return view
    }
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}