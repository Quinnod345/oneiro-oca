struct ContentView: View {
    @State private var items: [ClipboardItem] = [
        ClipboardItem(content: "Sample text", type: .text, timestamp: Date().addingTimeInterval(-86400)),
        ClipboardItem(content: "https://example.com", type: .link, timestamp: Date().addingTimeInterval(-172800)),
        ClipboardItem(content: "image.png", type: .image, timestamp: Date().addingTimeInterval(-259200)),
        ClipboardItem(content: "func example() {}", type: .code, timestamp: Date().addingTimeInterval(-432000))
    ]
    
    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                ClipboardRowView(item: item, isSelected: false)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 2)
            }
            
            ForEach(items.count..<8, id: \.self) { _ in
                EmptyRowView()
                    .padding(.horizontal, 12)
                    .padding(.vertical, 2)
            }
        }
        .padding(.vertical, 8)
        .background(Color(NSColor.controlBackgroundColor))
        .frame(width: 320, height: 280)
    }
}

struct ClipboardRowView: View {
    let item: ClipboardItem
    let isSelected: Bool
    @State private var isHovering = false
    
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: item.type.glyph)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(.hierarchical)
                .foregroundColor(Color(NSColor.systemBlue))
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
        .frame(height: 30)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(backgroundColor)
        )
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.15)) {
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

struct EmptyRowView: View {
    var body: some View {
        HStack {
            RoundedRectangle(cornerRadius: 4)
                .strokeBorder(Color(NSColor.separatorColor), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .frame(height: 30)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}