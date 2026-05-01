struct ContentView: View {
    @State private var clipboardItems: [ClipboardItem] = [
        ClipboardItem(content: "Hello world! This is a test clipboard item with some longer text to see how it wraps.", createdAt: Date().addingTimeInterval(-86400 * 1)),
        ClipboardItem(content: "Another item", createdAt: Date().addingTimeInterval(-86400 * 4)),
        ClipboardItem(content: "Old item that needs attention", createdAt: Date().addingTimeInterval(-86400 * 8)),
        ClipboardItem(content: "Fresh item", createdAt: Date())
    ]
    @State private var selectedItem: ClipboardItem?
    
    var body: some View {
        NavigationSplitView {
            List(clipboardItems, selection: $selectedItem) { item in
                VStack(alignment: .leading, spacing: 8) {
                    Text(item.content)
                        .font(.body)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    
                    HStack {
                        Text(item.createdAt, style: .relative)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        
                        Spacer()
                        
                        Circle()
                            .fill(ageColor(for: item))
                            .frame(width: 6, height: 6)
                    }
                }
                .padding(.vertical, 12)
                .padding(.horizontal, 20)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.clear)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(.selection.opacity(selectedItem?.id == item.id ? 0.3 : 0))
                        )
                )
                .animation(.easeInOut(duration: 0.2), value: selectedItem?.id)
            }
            .listStyle(.sidebar)
            .navigationTitle("Clipboard History")
            .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 400)
            .background(.sidebar)
        } detail: {
            Group {
                if let selectedItem = selectedItem {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 24) {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("Content")
                                    .font(.headline)
                                    .foregroundColor(.primary)
                                
                                Text(selectedItem.content)
                                    .font(.body)
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(16)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(.regularMaterial)
                                    )
                            }
                            
                            VStack(alignment: .leading, spacing: 12) {
                                Text("Details")
                                    .font(.headline)
                                    .foregroundColor(.primary)
                                
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack {
                                        Text("Created:")
                                            .font(.body.weight(.medium))
                                        Spacer()
                                        Text(selectedItem.createdAt, style: .date)
                                            .font(.body)
                                            .foregroundStyle(.secondary)
                                    }
                                    
                                    HStack {
                                        Text("Age:")
                                            .font(.body.weight(.medium))
                                        Spacer()
                                        Text(selectedItem.createdAt, style: .relative)
                                            .font(.body)
                                            .foregroundStyle(.secondary)
                                    }
                                    
                                    HStack {
                                        Text("Length:")
                                            .font(.body.weight(.medium))
                                        Spacer()
                                        Text("\(selectedItem.content.count) characters")
                                            .font(.body)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .padding(16)
                                .background(
                                    RoundedRectangle(cornerRadius: 8)
                                        .fill(.regularMaterial)
                                )
                            }
                        }
                        .padding(24)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
                    .animation(.easeInOut(duration: 0.3), value: selectedItem?.id)
                } else {
                    VStack(spacing: 16) {
                        Image(systemName: "doc.on.clipboard")
                            .font(.system(size: 48))
                            .foregroundStyle(.tertiary)
                        
                        Text("Select an item to view details")
                            .font(.title2)
                            .foregroundStyle(.secondary)
                        
                        Text("Use ⌘1-⌘8 to quickly access clipboard slots")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            .background(.contentBackground)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    HStack(spacing: 8) {
                        ForEach(0..<8, id: \.self) { index in
                            ClipboardSlot(
                                item: index < clipboardItems.count ? clipboardItems[index] : nil,
                                index: index
                            )
                        }
                    }
                    .padding(.horizontal, 8)
                }
            }
        }
        .frame(minWidth: 900, minHeight: 650)
    }
    
    private func ageColor(for item: ClipboardItem) -> Color {
        let daysSinceCreated = Calendar.current.dateComponents([.day], from: item.createdAt, to: Date()).day ?? 0
        
        if daysSinceCreated == 0 {
            return .blue
        } else if daysSinceCreated <= 3 {
            return .green
        } else if daysSinceCreated <= 7 {
            return .orange
        } else {
            return .gray
        }
    }
}