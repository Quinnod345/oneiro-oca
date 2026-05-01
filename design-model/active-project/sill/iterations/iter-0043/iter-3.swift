struct ContentView: View {
    @State private var items: [ClipboardItem] = []
    @State private var selection = Set<UUID>()
    @State private var hoveredItem: UUID?
    
    let maxItems: Int = 8
    
    var body: some View {
        GeometryReader { geometry in
            NavigationSplitView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Text("Clipboard")
                            .font(scaledFont(for: geometry.size.width, base: .headline))
                            .foregroundStyle(.primary)
                        
                        Spacer()
                        
                        Text("\(items.count)/\(maxItems)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                    .padding(.horizontal, scaledPadding(for: geometry.size.width, base: 16))
                    .padding(.vertical, scaledPadding(for: geometry.size.width, base: 12))
                    
                    List(items, selection: $selection) { item in
                        itemRow(for: item, width: geometry.size.width)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(
                                top: scaledPadding(for: geometry.size.width, base: 4),
                                leading: 12,
                                bottom: scaledPadding(for: geometry.size.width, base: 4),
                                trailing: 12
                            ))
                    }
                    .listStyle(.sidebar)
                    .scrollContentBackground(.hidden)
                }
                .background(.regularMaterial)
                .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 400)
            } detail: {
                if let selectedItem = items.first(where: { selection.contains($0.id) }) {
                    detailView(for: selectedItem)
                } else {
                    ContentUnavailableView("No Selection", systemImage: "doc.on.clipboard", description: Text("Select a clipboard item to view its contents"))
                }
            }
        }
        .onAppear {
            setupMockData()
        }
    }
    
    private func itemRow(for item: ClipboardItem, width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: scaledPadding(for: width, base: 6)) {
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: item.contentType.icon)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(width: 12, height: 12)
                    
                    if width < 340 {
                        Text(contentTypeLabel(item.contentType))
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.tertiary)
                    }
                }
                
                Spacer()
                
                if width < 340 {
                    Text("⌘\(items.firstIndex(where: { $0.id == item.id }).map { $0 + 1 } ?? 1)")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.tertiary)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(.tertiary.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                }
                
                Text(timeAgoString(from: item.createdAt))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .monospacedDigit()
            }
            
            contentPreview(for: item, width: width)
                .font(scaledFont(for: width, base: .body))
                .foregroundStyle(.primary)
                .lineLimit(width < 340 ? 2 : 3)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, scaledPadding(for: width, base: 12))
        .padding(.vertical, scaledPadding(for: width, base: 10))
        .background {
            RoundedRectangle(cornerRadius: 8)
                .fill(backgroundFill(for: item))
        }
        .onHover { isHovered in
            withAnimation(.easeInOut(duration: 0.2)) {
                hoveredItem = isHovered ? item.id : nil
            }
        }
        .contentShape(Rectangle())
    }
    
    private func contentPreview(for item: ClipboardItem, width: CGFloat) -> some View {
        Group {
            switch item.contentType {
            case .code:
                Text(item.content)
                    .font(.system(scaledFontSize(for: width, base: 13), design: .monospaced))
                    .foregroundStyle(.secondary)
            case .link:
                HStack(spacing: 4) {
                    Image(systemName: "globe")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    Text(item.content)
                        .foregroundStyle(.secondary)
                }
            case .text:
                Text(item.content)
                    .foregroundStyle(.primary)
            }
        }
    }
    
    private func detailView(for item: ClipboardItem) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Image(systemName: item.contentType.icon)
                    .foregroundStyle(.secondary)
                Text(contentTypeLabel(item.contentType))
                    .font(.headline)
                    .foregroundStyle(.primary)
                Spacer()
                Text(timeAgoString(from: item.createdAt))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            
            ScrollView {
                Text(item.content)
                    .font(item.contentType == .code ? .system(.body, design: .monospaced) : .body)
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
        }
        .padding(24)
    }
    
    private func scaledFont(for width: CGFloat, base: Font) -> Font {
        let scale = min(max(width / 320.0, 0.8), 1.2)
        switch base {
        case .headline:
            return scale < 0.9 ? .subheadline.weight(.medium) : .headline
        case .body:
            return scale < 0.9 ? .caption : .body
        default:
            return base
        }
    }
    
    private func scaledFontSize(for width: CGFloat, base: CGFloat) -> CGFloat {
        let scale = min(max(width / 320.0, 0.8), 1.2)
        return base * scale
    }
    
    private func scaledPadding(for width: CGFloat, base: CGFloat) -> CGFloat {
        let scale = min(max(width / 320.0, 0.7), 1.0)
        return base * scale
    }
    
    private func backgroundFill(for item: ClipboardItem) -> Color {
        if selection.contains(item.id) {
            return Color.accentColor.opacity(0.12)
        } else if hoveredItem == item.id {
            return .fill.opacity(0.08)
        } else {
            return .clear
        }
    }
    
    private func contentTypeLabel(_ type: ClipboardItem.ContentType) -> String {
        switch type {
        case .text: return "Text"
        case .link: return "Link"
        case .code: return "Code"
        }
    }
    
    private func setupMockData() {
        items = [
            ClipboardItem(content: "https://developer.apple.com/documentation/swiftui", contentType: .link, createdAt: Date().addingTimeInterval(-300)),
            ClipboardItem(content: "func calculateTotal(items: [Item]) -> Double {\n    return items.reduce(0) { $0 + $1.price }\n}", contentType: .code, createdAt: Date().addingTimeInterval(-600)),
            ClipboardItem(content: "Remember to update the design system documentation before the team meeting tomorrow.", contentType: .text, createdAt: Date().addingTimeInterval(-1200)),
            ClipboardItem(content: "https://github.com/apple/swift-evolution", contentType: .link, createdAt: Date().addingTimeInterval(-1800)),
            ClipboardItem(content: "let configuration = URLSessionConfiguration.default\nconfiguration.timeoutIntervalForRequest = 30", contentType: .code, createdAt: Date().addingTimeInterval(-2400))
        ]
    }
    
    private func timeAgoString(from date: Date) -> String {
        let interval = Date().timeIntervalSince(date)
        let minutes = Int(interval / 60)
        let hours = minutes / 60
        
        if hours > 0 {
            return "\(hours)h"
        } else if minutes > 0 {
            return "\(minutes)m"
        } else {
            return "now"
        }
    }
}