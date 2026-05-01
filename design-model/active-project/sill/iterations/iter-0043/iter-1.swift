struct ContentView: View {
    @State private var items: [ClipboardItem] = []
    @State private var selection = Set<UUID>()
    @State private var hoveredItem: UUID?
    
    let maxItems: Int = 8
    
    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("Clipboard")
                        .font(.headline)
                        .foregroundStyle(.primary)
                    
                    Spacer()
                    
                    Text("\(items.count)/\(maxItems)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                
                List(items, selection: $selection) { item in
                    itemRow(for: item)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12))
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
    }
    
    private func itemRow(for item: ClipboardItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Circle()
                    .fill(.tint)
                    .frame(width: 6, height: 6)
                
                Spacer()
                
                Text(timeAgoString(from: item.createdAt))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .monospacedDigit()
            }
            
            Text(item.content)
                .font(.body)
                .foregroundStyle(.primary)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background {
            RoundedRectangle(cornerRadius: 8)
                .fill(hoveredItem == item.id ? .fill.opacity(0.5) : .clear)
        }
        .onHover { isHovered in
            hoveredItem = isHovered ? item.id : nil
        }
        .contentShape(Rectangle())
    }
    
    private func detailView(for item: ClipboardItem) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Clipboard Item")
                        .font(.headline)
                        .foregroundStyle(.primary)
                    
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
            }
            .padding(.bottom, 8)
            
            ScrollView {
                Text(item.content)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .textSelection(.enabled)
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