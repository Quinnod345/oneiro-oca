struct ContentView: View {
    @StateObject private var clipboardManager: ClipboardManager = ClipboardManager()
    
    var body: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(.regularMaterial)
                .frame(height: 24)
                .overlay(
                    Text("Clipboard Shelf")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.primary),
                    alignment: .center
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
            .background(.thickMaterial)
        }
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(.separator, lineWidth: 1)
        )
        .frame(width: 400, height: 100)
    }
}

struct ClipboardSlot: View {
    let item: ClipboardItem?
    let onSelect: (ClipboardItem) -> Void
    @State private var isHovered: Bool = false
    
    var body: some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(.thinMaterial)
            .overlay(
                Group {
                    if let item = item {
                        VStack(spacing: 2) {
                            Image(systemName: iconName(for: item.type))
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(.accentColor)
                            
                            Text(item.displayText)
                                .font(.system(size: 11, weight: .regular))
                                .foregroundColor(.primary)
                                .lineLimit(2)
                                .multilineTextAlignment(.center)
                        }
                        .scaleEffect(isHovered ? 1.05 : 1.0)
                        .animation(.easeInOut(duration: 0.15), value: isHovered)
                    }
                }
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(.separator, lineWidth: 1)
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
    }
    
    private func iconName(for type: ClipboardItem.ClipboardType) -> String {
        switch type {
        case .text: return "doc.text"
        case .file: return "doc"
        case .url: return "link"
        }
    }
}