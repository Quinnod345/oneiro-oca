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
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.content)
                        .font(.body)
                        .lineLimit(2)
                    
                    Text(item.createdAt, style: .relative)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 2)
            }
            .navigationTitle("Clipboard History")
            .navigationSplitViewColumnWidth(min: 250, ideal: 300, max: 400)
            .background(.regularMaterial)
        } detail: {
            Group {
                if let selectedItem = selectedItem {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            Text("Content")
                                .font(.headline)
                            
                            Text(selectedItem.content)
                                .font(.body)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            
                            Text("Created")
                                .font(.headline)
                            
                            Text(selectedItem.createdAt, style: .date)
                                .font(.body)
                                .foregroundStyle(.secondary)
                        }
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                } else {
                    Text("Select an item to view details")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                }
            }
            .background(.contentBackground)
            .toolbar {
                ToolbarItem {
                    HStack(spacing: 12) {
                        ForEach(0..<8, id: \.self) { index in
                            ClipboardSlot(
                                item: index < clipboardItems.count ? clipboardItems[index] : nil,
                                index: index
                            )
                        }
                    }
                }
            }
        }
        .frame(minWidth: 800, minHeight: 600)
    }
}