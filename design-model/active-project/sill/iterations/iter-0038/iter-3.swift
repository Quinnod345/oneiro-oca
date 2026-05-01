struct ContentView: View {
    @State private var clipboardItems: [ClipboardItem] = [
        ClipboardItem(content: "Hello world! This is a test clipboard item with some longer text to see how it wraps.", createdAt: Date().addingTimeInterval(-86400 * 1)),
        ClipboardItem(content: "Another item", createdAt: Date().addingTimeInterval(-86400 * 4)),
        ClipboardItem(content: "Old item that needs attention", createdAt: Date().addingTimeInterval(-86400 * 8)),
        ClipboardItem(content: "Fresh item", createdAt: Date())
    ]
    @State private var selectedItem: ClipboardItem?
    @State private var hoveredItem: ClipboardItem?
    
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
                        
                        Image(systemName: ageSymbol(for: item))
                            .font(.caption)
                            .foregroundStyle(ageStyle(for: item))
                    }
                }
                .padding(.vertical, 12)
                .padding(.horizontal, 16)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(rowBackgroundColor(for: item))
                        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: selectedItem?.id)
                        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: hoveredItem?.id)
                )
                .onHover { isHovered in
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                        hoveredItem = isHovered ? item : nil
                    }
                }
            }
            .listStyle(.sidebar)
            .navigationTitle("Clipboard History")
            .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 400)
        } detail: {
            Group {
                if let selectedItem = selectedItem {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 24) {
                            VStack(alignment: .leading, spacing: 16) {
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
                            
                            VStack(alignment: .leading, spacing: 16) {
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
                    .transition(.asymmetric(
                        insertion: .opacity.combined(with: .scale(scale: 0.95)).combined(with: .offset(x: 20)),
                        removal: .opacity.combined(with: .scale(scale: 1.05))
                    ))
                    .animation(.spring(response: 0.5, dampingFraction: 0.8, blendDuration: 0.1), value: selectedItem?.id)
                } else {
                    VStack(spacing: 24) {
                        Image(systemName: "doc.on.clipboard")
                            .font(.system(size: 64, weight: .thin))
                            .foregroundStyle(.tertiary)
                        
                        VStack(spacing: 8) {
                            Text("Select a clipboard item")
                                .font(.largeTitle)
                                .fontWeight(.medium)
                                .foregroundStyle(.primary)
                            
                            Text("Choose an item from the list to view its details")
                                .font(.body)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
                    .animation(.spring(response: 0.4, dampingFraction: 0.8), value: selectedItem == nil)
                }
            }
        }
    }
    
    private func ageSymbol(for item: ClipboardItem) -> String {
        let ageInDays = Calendar.current.dateComponents([.day], from: item.createdAt, to: Date()).day ?? 0
        
        switch ageInDays {
        case 0:
            return "circle.fill"
        case 1...3:
            return "circle"
        case 4...7:
            return "circle.dotted"
        default:
            return "minus"
        }
    }
    
    private func ageStyle(for item: ClipboardItem) -> Color {
        let ageInDays = Calendar.current.dateComponents([.day], from: item.createdAt, to: Date()).day ?? 0
        
        switch ageInDays {
        case 0:
            return .secondary
        case 1...3:
            return .secondary
        case 4...7:
            return .secondary.opacity(0.7)
        default:
            return .tertiary
        }
    }
    
    private func rowBackgroundColor(for item: ClipboardItem) -> Color {
        let ageInDays = Calendar.current.dateComponents([.day], from: item.createdAt, to: Date()).day ?? 0
        let isSelected = selectedItem?.id == item.id
        let isHovered = hoveredItem?.id == item.id
        
        if isSelected {
            switch ageInDays {
            case 0:
                return .blue.opacity(0.15)
            case 1...3:
                return .blue.opacity(0.12)
            case 4...7:
                return .blue.opacity(0.1)
            default:
                return .blue.opacity(0.08)
            }
        } else if isHovered {
            switch ageInDays {
            case 0:
                return .primary.opacity(0.08)
            case 1...3:
                return .primary.opacity(0.06)
            case 4...7:
                return .primary.opacity(0.05)
            default:
                return .primary.opacity(0.04)
            }
        } else {
            switch ageInDays {
            case 0:
                return .clear
            case 1...3:
                return .primary.opacity(0.02)
            case 4...7:
                return .primary.opacity(0.015)
            default:
                return .primary.opacity(0.01)
            }
        }
    }
}