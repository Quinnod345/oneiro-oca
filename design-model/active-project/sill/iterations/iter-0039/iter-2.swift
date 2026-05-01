struct ContentView: View {
    @State private var items: [SillItem?] = Array(repeating: nil, count: 8)
    @State private var hoveredSlot: Int? = nil
    @State private var draggedOverSlot: Int? = nil
    @Environment(\.colorScheme) var colorScheme
    
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
                .fill(.clear)
                .background(
                    VisualEffectView(material: .hudWindow, blendingMode: .behindWindow)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                )
                .shadow(color: colorScheme == .dark ? Color.black.opacity(0.3) : Color.black.opacity(0.1), radius: 10, x: 0, y: 5)
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
    @Environment(\.colorScheme) var colorScheme
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(.clear)
                .background(
                    VisualEffectView(
                        material: item != nil ? .menu : .contentBackground,
                        blendingMode: .behindWindow
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(
                            isDraggedOver ? Color.accentColor.opacity(0.6) : 
                            (isHovered ? Color.primary.opacity(0.2) : Color.primary.opacity(0.1)),
                            lineWidth: isDraggedOver ? 2 : 1
                        )
                )
                .scaleEffect(isDraggedOver ? 1.05 : (isHovered ? 1.02 : 1.0))
                .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isDraggedOver)
                .animation(.easeInOut(duration: 0.2), value: isHovered)
            
            if let item = item {
                VStack(spacing: 6) {
                    Image(systemName: item.iconName)
                        .font(.title2)
                        .fontDesign(.rounded)
                        .foregroundStyle(item.hasAmberTint ? Color.orange : Color.accentColor)
                        .symbolRenderingMode(.hierarchical)
                    
                    Text(item.displayText)
                        .font(.caption)
                        .fontDesign(.rounded)
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                        .truncationMode(.tail)
                }
                .padding(.horizontal, 6)
                
                if isHovered {
                    Button(action: onDelete) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.caption)
                            .fontDesign(.rounded)
                            .foregroundStyle(.secondary)
                            .background(
                                Circle()
                                    .fill(colorScheme == .dark ? Color.black.opacity(0.6) : Color.white.opacity(0.9))
                                    .frame(width: 16, height: 16)
                            )
                    }
                    .buttonStyle(.plain)
                    .offset(x: 30, y: -38)
                    .transition(.scale.combined(with: .opacity))
                }
            } else {
                VStack(spacing: 6) {
                    Image(systemName: isDraggedOver ? "plus.circle.fill" : "plus.circle")
                        .font(.title2)
                        .fontDesign(.rounded)
                        .foregroundStyle(.tertiary)
                        .symbolRenderingMode(.hierarchical)
                    
                    Text("Drop here")
                        .font(.caption2)
                        .fontDesign(.rounded)
                        .foregroundStyle(.tertiary)
                }
            }
        }
    }
}