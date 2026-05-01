struct ClipboardItem: Identifiable {
    let id = UUID()
    let content: String
    let type: ClipboardItemType
    let timestamp: Date
}

enum ClipboardItemType {
    case text
    case link
    case image
    case code
    
    var glyph: String {
        switch self {
        case .text:
            return "doc.text"
        case .link:
            return "link"
        case .image:
            return "photo"
        case .code:
            return "curlybraces"
        }
    }
}

struct ContentView: View {
    @State private var items: [ClipboardItem] = [
        ClipboardItem(content: "Sample text", type: .text, timestamp: Date().addingTimeInterval(-86400)),
        ClipboardItem(content: "https://example.com", type: .link, timestamp: Date().addingTimeInterval(-172800)),
        ClipboardItem(content: "image.png", type: .image, timestamp: Date().addingTimeInterval(-259200)),
        ClipboardItem(content: "func example() {}", type: .code, timestamp: Date().addingTimeInterval(-432000))
    ]
    
    var body: some View {
        VStack(spacing: 12) {
            ForEach(items) { item in
                ClipboardRowView(item: item, isSelected: false)
            }
        }
        .padding(16)
        .background(
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
        )
        .frame(width: 320, height: 280)
    }
}

struct ClipboardRowView: View {
    let item: ClipboardItem
    let isSelected: Bool
    @State private var isHovering: Bool = false
    
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: item.type.glyph)
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(Color(NSColor.secondaryLabelColor))
                .frame(width: 20, height: 20)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(item.content)
                    .font(.system(size: 13))
                    .foregroundColor(Color(NSColor.labelColor))
                    .lineLimit(1)
                    .truncationMode(.tail)
                
                Text(formatTimestamp(item.timestamp))
                    .font(.system(size: 11))
                    .foregroundColor(Color(NSColor.secondaryLabelColor))
            }
            
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(minHeight: 44)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(backgroundColor)
        )
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.08)) {
                isHovering = hovering
            }
        }
    }
    
    private var backgroundColor: Color {
        if isSelected {
            return Color(NSColor.selectedContentBackgroundColor)
        } else if isHovering {
            return Color(NSColor.controlAccentColor).opacity(0.1)
        } else {
            return Color(NSColor.controlBackgroundColor)
        }
    }
    
    private func formatTimestamp(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.dateTimeStyle = .named
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let visualEffectView = NSVisualEffectView()
        visualEffectView.material = material
        visualEffectView.blendingMode = blendingMode
        visualEffectView.state = .active
        return visualEffectView
    }
    
    func updateNSView(_ visualEffectView: NSVisualEffectView, context: Context) {
        visualEffectView.material = material
        visualEffectView.blendingMode = blendingMode
    }
}