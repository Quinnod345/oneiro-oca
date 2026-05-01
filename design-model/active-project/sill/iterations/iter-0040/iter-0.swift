struct ContentView: View {
    @StateObject private var clipboardManager: ClipboardManager = ClipboardManager()
    
    var body: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(LinearGradient(
                    colors: [
                        Color(red: 0.96, green: 0.90, blue: 0.78),
                        Color(red: 0.92, green: 0.84, blue: 0.70),
                        Color(red: 0.88, green: 0.78, blue: 0.62)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                ))
                .frame(height: 24)
                .overlay(
                    Text("Clipboard Shelf")
                        .font(.system(size: 11, weight: .medium, design: .default))
                        .foregroundColor(Color(red: 0.35, green: 0.25, blue: 0.15))
                        .padding(.top, 4),
                    alignment: .top
                )
            
            HStack(spacing: 4) {
                ForEach(0..<8, id: \.self) { index in
                    ClipboardSlot(
                        item: index < clipboardManager.items.count ? clipboardManager.items[index] : nil,
                        onSelect: { item in
                            clipboardManager.selectItem(item)
                        }
                    )
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 12)
            .background(
                LinearGradient(
                    colors: [
                        Color(red: 0.88, green: 0.78, blue: 0.62),
                        Color(red: 0.82, green: 0.70, blue: 0.54),
                        Color(red: 0.77, green: 0.65, blue: 0.45)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
        .background(Color(red: 0.96, green: 0.90, blue: 0.78))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color(red: 0.65, green: 0.55, blue: 0.42), lineWidth: 0.5)
        )
        .shadow(color: Color.black.opacity(0.25), radius: 12, x: 0, y: 4)
        .frame(width: 400, height: 100)
    }
}

struct ClipboardSlot: View {
    let item: ClipboardItem?
    let onSelect: (ClipboardItem) -> Void
    @State private var isHovered: Bool = false
    
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(
                LinearGradient(
                    colors: [
                        Color(red: 0.72, green: 0.60, blue: 0.42),
                        Color(red: 0.65, green: 0.52, blue: 0.35),
                        Color(red: 0.58, green: 0.45, blue: 0.28)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .fill(
                        RadialGradient(
                            colors: [
                                Color.black.opacity(0.0),
                                Color.black.opacity(0.15),
                                Color.black.opacity(0.25)
                            ],
                            center: .center,
                            startRadius: 8,
                            endRadius: 20
                        )
                    )
                    .blendMode(.multiply)
            )
            .overlay(
                Group {
                    if let item = item {
                        VStack(spacing: 2) {
                            Image(systemName: iconName(for: item.type))
                                .font(.system(size: 12, weight: .medium, design: .default))
                                .foregroundColor(item.tint)
                            
                            Text(item.displayText)
                                .font(.system(size: 8, weight: .regular, design: .default))
                                .foregroundColor(item.tint)
                                .lineLimit(2)
                                .multilineTextAlignment(.center)
                        }
                        .opacity(item.opacity)
                        .scaleEffect(isHovered ? 1.05 : 1.0)
                        .animation(.easeInOut(duration: 0.15), value: isHovered)
                    } else {
                        Rectangle()
                            .fill(Color.clear)
                    }
                }
            )
            .frame(width: 40, height: 52)
            .onHover { hovering in
                isHovered = hovering
            }
            .onTapGesture {
                if let item = item {
                    onSelect(item)
                }
            }
            .shadow(color: Color.black.opacity(0.4), radius: 2, x: 0, y: 2)
    }
    
    private func iconName(for type: ClipboardItem.ClipboardType) -> String {
        switch type {
        case .text: return "doc.text"
        case .file: return "doc"
        case .url: return "link"
        }
    }
}