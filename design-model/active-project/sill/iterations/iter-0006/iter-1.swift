struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(name: "Meeting Notes", type: .text, dateAdded: Date().addingTimeInterval(-3600), content: "Quarterly review discussion points..."),
        ShelfItem(name: "Design.sketch", type: .file, dateAdded: Date().addingTimeInterval(-86400 * 2), content: ""),
        ShelfItem(name: "Inspiration", type: .image, dateAdded: Date().addingTimeInterval(-86400 * 5), content: ""),
        ShelfItem(name: "Linear", type: .url, dateAdded: Date().addingTimeInterval(-86400 * 10), content: "linear.app")
    ]
    
    @State private var dragOver: Int? = nil
    
    var body: some View {
        HStack(spacing: 8) {
            ForEach(0..<8, id: \.self) { index in
                ShelfSlot(
                    item: index < items.count ? items[index] : nil,
                    isDropTarget: dragOver == index
                )
                .onDrop(of: [.text, .fileURL, .image], isTargeted: Binding(
                    get: { dragOver == index },
                    set: { newValue in
                        if newValue {
                            dragOver = index
                        } else if dragOver == index {
                            dragOver = nil
                        }
                    }
                )) { providers in
                    handleDrop(providers: providers, at: index)
                    return true
                }
            }
        }
        .padding(16)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(.separator, lineWidth: 0.5)
        )
    }
    
    private func handleDrop(providers: [NSItemProvider], at index: Int) -> Void {
        guard let provider = providers.first else { return }
        
        if provider.hasItemConformingToTypeIdentifier("public.plain-text") {
            provider.loadItem(forTypeIdentifier: "public.plain-text", options: nil) { (data, error) in
                if let text = data as? String {
                    DispatchQueue.main.async {
                        addItem(name: "Text Note", type: .text, content: text, at: index)
                    }
                }
            }
        } else if provider.hasItemConformingToTypeIdentifier("public.file-url") {
            provider.loadItem(forTypeIdentifier: "public.file-url", options: nil) { (data, error) in
                if let url = data as? URL {
                    DispatchQueue.main.async {
                        addItem(name: url.lastPathComponent, type: .file, content: url.path, at: index)
                    }
                }
            }
        }
    }
    
    private func addItem(name: String, type: ShelfItem.ItemType, content: String, at index: Int) -> Void {
        let newItem = ShelfItem(name: name, type: type, dateAdded: Date(), content: content)
        
        if index < items.count {
            items[index] = newItem
        } else {
            items.append(newItem)
        }
        
        withAnimation(.spring(response: 0.6, dampingFraction: 0.7)) {
            dragOver = nil
        }
    }
}

struct ShelfSlot: View {
    let item: ShelfItem?
    let isDropTarget: Bool
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(.quaternary)
                .frame(width: 80, height: 80)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(.separator, lineWidth: 0.5)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(.tint.opacity(isDropTarget ? 0.8 : 0), lineWidth: 2)
                        .animation(.easeInOut(duration: 0.2), value: isDropTarget)
                )
            
            if let item = item {
                VStack(spacing: 4) {
                    Image(systemName: item.type.iconName)
                        .font(.system(size: 20, weight: .medium))
                        .foregroundColor(item.type.iconColor)
                    
                    Text(item.name)
                        .font(.system(size: 10, weight: .medium, design: .default))
                        .foregroundColor(.primary)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                        .frame(width: 72)
                    
                    Text(timeAgoString(from: item.dateAdded))
                        .font(.system(size: 8, weight: .regular, design: .default))
                        .foregroundColor(.secondary)
                }
                .padding(8)
            } else {
                Text(isDropTarget ? "Drop Here" : "")
                    .font(.system(size: 10, weight: .medium, design: .default))
                    .foregroundColor(.secondary)
                    .animation(.easeInOut(duration: 0.2), value: isDropTarget)
            }
        }
        .frame(width: 80, height: 80)
    }
    
    private func timeAgoString(from date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}