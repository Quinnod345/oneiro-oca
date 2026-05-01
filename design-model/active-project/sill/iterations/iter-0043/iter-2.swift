struct ContentView: View {
    @State private var items: [ClipboardItem] = []
    @State private var selection = Set<UUID>()
    @State private var hoveredItem: UUID?
    @State private var isCompactMode = false
    @State private var selectionScale = 1.0
    
    let maxItems: Int = 8
    
    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("Clipboard")
                        .font(isCompactMode ? .subheadline.weight(.medium) : .headline)
                        .foregroundStyle(.primary)
                    
                    Spacer()
                    
                    Button(action: { withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) { isCompactMode.toggle() } }) {
                        Image(systemName: isCompactMode ? "rectangle.expand.vertical" : "rectangle.compress.vertical")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    
                    Text("\(items.count)/\(maxItems)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, isCompactMode ? 8 : 12)
                
                List(items, selection: $selection) { item in
                    itemRow(for: item)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: isCompactMode ? 2 : 4, leading: 12, bottom: isCompactMode ? 2 : 4, trailing: 12))
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
        .onAppear {
            setupMockData()
        }
        .onChange(of: selection) { _, _ in
            withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
                selectionScale = 1.05
            }
            withAnimation(.spring(response: 0.4, dampingFraction: 0.7).delay(0.1)) {
                selectionScale = 1.0
            }
        }
    }
    
    private func itemRow(for item: ClipboardItem) -> some View {
        VStack(alignment: .leading, spacing: isCompactMode ? 3 : 6) {
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: item.contentType.icon)
                        .font(.caption)
                        .foregroundStyle(item.contentType.color)
                        .frame(width: 12, height: 12)
                    
                    if isCompactMode {
                        Text(item.contentType == .text ? "Text" : item.contentType == .link ? "Link" : "Code")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(item.contentType.color)
                    }
                }
                
                Spacer()
                
                if isCompactMode {
                    Text("⌘\(items.firstIndex(where: { $0.id == item.id }).map { $0 + 1 } ?? 1)")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.tertiary)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(.tertiary.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                }
                
                Text(timeAgoString(from: item.createdAt))
                    .font(isCompactMode ? .caption2 : .caption2)
                    .foregroundStyle(.tertiary)
                    .monospacedDigit()
            }
            
            contentPreview(for: item)
                .font(isCompactMode ? .caption : .body)
                .foregroundStyle(.primary)
                .lineLimit(isCompactMode ? 2 : 3)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, isCompactMode ? 8 : 12)
        .padding(.vertical, isCompactMode ? 6 : 10)
        .background {
            RoundedRectangle(cornerRadius: 8)
                .fill(selection.contains(item.id) ? item.contentType.color.opacity(0.15) : 
                     hoveredItem == item.id ? .fill.opacity(0.5) : .clear)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(selection.contains(item.id) ? item.contentType.color.opacity(0.3) : .clear, lineWidth: 1)
                )
        }
        .scaleEffect(selection.contains(item.id) ? selectionScale : 1.0)
        .onHover { isHovered in
            withAnimation(.easeInOut(duration: 0.2)) {
                hoveredItem = isHovered ? item.id : nil
            }
        }
        .contentShape(Rectangle())
    }
    
    private func contentPreview(for item: ClipboardItem) -> some View {
        Group {
            switch item.contentType {
            case .code:
                Text(item.content)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.orange)
            case .link:
                HStack(spacing: 4) {
                    Image(systemName: "globe")
                        .font(.caption2)
                        .foregroundStyle(.green)
                    Text(item.content)
                        .foregroundStyle(.green)
                }
            case .text:
                Text(item.content)
            }
        }
    }
    
    private func detailView(for item: ClipboardItem) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Image(systemName: item.contentType.icon)
                            .font(.headline)
                            .foregroundStyle(item.contentType.color)
                        
                        Text(item.contentType == .text ? "Text Content" : 
                             item.contentType == .link ? "Link" : "Code Snippet")
                            .font(.headline)
                            .foregroundStyle(.primary)
                    }
                    
                    Text("Created \(timeAgoString(from: item.createdAt))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                
                Spacer()
                
                Button("Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(item.content, forType: .string)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.regular)
            }
            .padding(.bottom, 8)
            
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if item.contentType == .code {
                        Text(item.content)
                            .font(.system(.body, design: .monospaced))
                            .foregroundStyle(.primary)
                            .textSelection(.enabled)
                            .padding(12)
                            .background(.quaternary.opacity(0.5))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    } else {
                        Text(item.content)
                            .font(.body)
                            .foregroundStyle(.primary)
                            .textSelection(.enabled)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            
            Spacer()
        }
        .padding(20)
        .background(.regularMaterial)
    }
    
    private func setupMockData() {
        let sampleContents = [
            "Design a minimalist todo app interface",
            "Remember to buy fresh herbs for tonight's dinner",
            "https://github.com/user/interesting-repo",
            "The quick brown fox jumps over the lazy dog",
            "func calculateDistance(from point1: CGPoint, to point2: CGPoint) -> Double {\n    return sqrt(pow(point2.x - point1.x, 2) + pow(point2.y - point1.y, 2))\n}",
            "Meeting notes:\n- Review Q3 metrics\n- Plan team offsite\n- Discuss new feature roadmap",
            "🎨 Color palette: #FF6B6B, #4ECDC4, #45B7D1, #96CEB4",
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."
        ]
        
        items = sampleContents.enumerated().map { index, content in
            ClipboardItem(
                content: content,
                createdAt: Date().addingTimeInterval(-Double(index * 3600))
            )
        }
    }
    
    private func timeAgoString(from date: Date) -> String {
        let now = Date()
        let timeInterval = now.timeIntervalSince(date)
        
        if timeInterval < 60 {
            return "now"
        } else if timeInterval < 3600 {
            let minutes = Int(timeInterval / 60)
            return "\(minutes)m"
        } else if timeInterval < 86400 {
            let hours = Int(timeInterval / 3600)
            return "\(hours)h"
        } else {
            let days = Int(timeInterval / 86400)
            return "\(days)d"
        }
    }
}