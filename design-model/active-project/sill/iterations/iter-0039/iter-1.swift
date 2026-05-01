struct SillItem: Identifiable {
    let id = UUID()
    let type: ItemType
    let content: String
    let createdAt: Date
    
    enum ItemType {
        case text, file, url
    }
    
    var iconName: String {
        switch type {
        case .text:
            return "doc.text"
        case .file:
            return "doc"
        case .url:
            return "link"
        }
    }
    
    var displayText: String {
        switch type {
        case .text:
            return String(content.prefix(50))
        case .file:
            if let url = URL(string: content) {
                return url.lastPathComponent
            }
            return "File"
        case .url:
            if let url = URL(string: content), let host = url.host {
                return host
            }
            return "URL"
        }
    }
    
    var hasAmberTint: Bool {
        let daysSinceCreation = -createdAt.timeIntervalSinceNow / 86400
        return daysSinceCreation > 7
    }
}

struct ContentView: View {
    @State private var items: [SillItem?] = Array(repeating: nil, count: 8)
    @State private var hoveredSlot: Int? = nil
    @State private var draggedOverSlot: Int? = nil
    
    private let slotSize: CGSize = CGSize(width: 80, height: 100)
    
    var body: some View {
        HStack(spacing: 20) {
            ForEach(0..<8, id: \.self) { index in
                SlotView(
                    item: items[index],
                    isHovered: hoveredSlot == index,
                    isDraggedOver: draggedOverSlot == index,
                    onDelete: { deleteItem(at: index) }
                )
                .frame(width: slotSize.width, height: slotSize.height)
                .onHover { hovering in
                    withAnimation(.easeInOut(duration: 0.2)) {
                        hoveredSlot = hovering ? index : nil
                    }
                }
                .onDrop(of: ["public.text", "public.file-url", "public.url"], isTargeted: Binding(
                    get: { draggedOverSlot == index },
                    set: { isDragged in
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                            draggedOverSlot = isDragged ? index : nil
                        }
                    }
                )) { providers in
                    _ = handleDrop(providers: providers, at: index)
                    return true
                }
            }
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(.regularMaterial)
                .shadow(color: Color.black.opacity(0.1), radius: 10, x: 0, y: 5)
        )
        .frame(width: 720, height: 160)
        .onAppear {
            setupSampleData()
        }
    }
    
    private func deleteItem(at index: Int) {
        withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) {
            items[index] = nil
        }
    }
    
    private func handleDrop(providers: [NSItemProvider], at index: Int) -> Bool {
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier("public.file-url") {
                provider.loadItem(forTypeIdentifier: "public.file-url", options: nil) { data, error in
                    if let data = data as? Data,
                       let url = URL(dataRepresentation: data, relativeTo: nil) {
                        DispatchQueue.main.async {
                            withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                                items[index] = SillItem(type: .file, content: url.absoluteString, createdAt: Date())
                            }
                        }
                    }
                }
                return true
            } else if provider.hasItemConformingToTypeIdentifier("public.url") {
                provider.loadItem(forTypeIdentifier: "public.url", options: nil) { data, error in
                    if let data = data as? Data,
                       let url = URL(dataRepresentation: data, relativeTo: nil) {
                        DispatchQueue.main.async {
                            withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                                items[index] = SillItem(type: .url, content: url.absoluteString, createdAt: Date())
                            }
                        }
                    }
                }
                return true
            } else if provider.hasItemConformingToTypeIdentifier("public.text") {
                provider.loadItem(forTypeIdentifier: "public.text", options: nil) { data, error in
                    if let data = data as? Data,
                       let text = String(data: data, encoding: .utf8) {
                        DispatchQueue.main.async {
                            withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                                items[index] = SillItem(type: .text, content: text, createdAt: Date())
                            }
                        }
                    }
                }
                return true
            }
        }
        return false
    }
    
    private func setupSampleData() {
        items[0] = SillItem(type: .text, content: "Meeting notes from yesterday's standup about the new feature rollout", createdAt: Date().addingTimeInterval(-86400))
        items[2] = SillItem(type: .file, content: "file:///Users/test/Documents/quarterly-report.pdf", createdAt: Date().addingTimeInterval(-259200))
        items[4] = SillItem(type: .url, content: "https://github.com/apple/swift", createdAt: Date().addingTimeInterval(-691200))
        items[6] = SillItem(type: .text, content: "Buy groceries", createdAt: Date().addingTimeInterval(-1209600))
    }
}

struct SlotView: View {
    let item: SillItem?
    let isHovered: Bool
    let isDraggedOver: Bool
    let onDelete: () -> Void
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(isDraggedOver ? Color.blue.opacity(0.2) : Color.gray.opacity(0.1))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(isDraggedOver ? Color.blue : Color.gray.opacity(0.3), lineWidth: 1.5)
                )
                .shadow(color: Color.black.opacity(0.05), radius: 4, x: 0, y: 2)
            
            if let item = item {
                VStack(spacing: 8) {
                    Image(systemName: item.iconName)
                        .font(.system(size: 20, weight: .medium))
                        .foregroundColor(item.hasAmberTint ? Color.orange : Color.gray)
                        .symbolRenderingMode(.hierarchical)
                    
                    Text(item.displayText)
                        .font(.system(size: 12, weight: .medium, design: .default))
                        .foregroundColor(Color.black)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .truncationMode(.tail)
                        .padding(.horizontal, 4)
                }
                .padding(8)
                .overlay(
                    Button(action: onDelete) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 16))
                            .foregroundColor(Color.gray)
                            .background(Circle().fill(Color.white))
                    }
                    .buttonStyle(PlainButtonStyle())
                    .opacity(isHovered ? 1 : 0)
                    .animation(.easeInOut(duration: 0.2), value: isHovered),
                    alignment: .topTrailing
                )
            } else {
                VStack(spacing: 4) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 24))
                        .foregroundColor(Color.gray.opacity(0.5))
                    
                    Text("Drop here")
                        .font(.system(size: 11, weight: .medium, design: .default))
                        .foregroundColor(Color.gray.opacity(0.5))
                }
                .opacity(isDraggedOver ? 1 : 0.6)
            }
        }
        .scaleEffect(isDraggedOver ? 1.05 : 1.0)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isDraggedOver)
    }
}