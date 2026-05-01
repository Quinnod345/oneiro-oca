struct ContentView: View {
    @State private var items: [SillItem?] = Array(repeating: nil, count: 8)
    @State private var hoveredSlot: Int? = nil
    @State private var draggedOverSlot: Int? = nil
    
    private let slotSize: CGSize = CGSize(width: 52, height: 80)
    private let parchmentColor = Color(red: 0.96, green: 0.93, blue: 0.87)
    private let amberGlow = Color(red: 0.92, green: 0.65, blue: 0.25)
    
    var body: some View {
        HStack(spacing: 8) {
            ForEach(0..<8, id: \.self) { index in
                SlotView(
                    item: items[index],
                    isHovered: hoveredSlot == index,
                    isDraggedOver: draggedOverSlot == index,
                    onDelete: { deleteItem(at: index) }
                )
                .frame(width: slotSize.width, height: slotSize.height)
                .onHover { hovering in
                    hoveredSlot = hovering ? index : nil
                }
                .onDrop(of: ["public.text", "public.file-url", "public.url"], isTargeted: Binding(
                    get: { draggedOverSlot == index },
                    set: { isDragged in
                        draggedOverSlot = isDragged ? index : nil
                    }
                )) { providers in
                    handleDrop(providers: providers, at: index)
                    return true
                }
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(parchmentColor)
                .shadow(color: Color.black.opacity(0.15), radius: 8, x: 0, y: 4)
        )
        .frame(width: 480, height: 120)
        .onAppear {
            setupSampleData()
        }
    }
    
    private func deleteItem(at index: Int) {
        items[index] = nil
    }
    
    private func handleDrop(providers: [NSItemProvider], at index: Int) -> Bool {
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier("public.file-url") {
                provider.loadItem(forTypeIdentifier: "public.file-url", options: nil) { data, error in
                    if let data = data as? Data,
                       let url = URL(dataRepresentation: data, relativeTo: nil) {
                        DispatchQueue.main.async {
                            items[index] = SillItem(type: .file, content: url.absoluteString, createdAt: Date())
                        }
                    }
                }
                return true
            } else if provider.hasItemConformingToTypeIdentifier("public.url") {
                provider.loadItem(forTypeIdentifier: "public.url", options: nil) { data, error in
                    if let data = data as? Data,
                       let url = URL(dataRepresentation: data, relativeTo: nil) {
                        DispatchQueue.main.async {
                            items[index] = SillItem(type: .url, content: url.absoluteString, createdAt: Date())
                        }
                    }
                }
                return true
            } else if provider.hasItemConformingToTypeIdentifier("public.text") {
                provider.loadItem(forTypeIdentifier: "public.text", options: nil) { data, error in
                    if let data = data as? Data,
                       let text = String(data: data, encoding: .utf8) {
                        DispatchQueue.main.async {
                            items[index] = SillItem(type: .text, content: text, createdAt: Date())
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
    
    private let parchmentColor = Color(red: 0.96, green: 0.93, blue: 0.87)
    private let amberGlow = Color(red: 0.92, green: 0.65, blue: 0.25)
    private let slotColor = Color(red: 0.88, green: 0.84, blue: 0.76)
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(isDraggedOver ? amberGlow.opacity(0.3) : slotColor)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(isDraggedOver ? amberGlow : Color.clear, lineWidth: 2)
                )
                .shadow(color: Color.black.opacity(0.1), radius: 2, x: 0, y: 1)
            
            if let item = item {
                VStack(spacing: 4) {
                    Image(systemName: item.iconName)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(item.hasAmberTint ? amberGlow : Color.black.opacity(0.7))
                    
                    Text(item.displayText)
                        .font(.system(size: 9, weight: .medium, design: .default))
                        .foregroundColor(item.hasAmberTint ? amberGlow : Color.black.opacity(0.8))
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                }
                .opacity(item.opacity)
                .padding(4)
                
                if isHovered {
                    VStack {
                        HStack {
                            Spacer()
                            Button(action: onDelete) {
                                Image(systemName: "xmark")
                                    .font(.system(size: 8, weight: .bold))
                                    .foregroundColor(Color.white)
                            }
                            .buttonStyle(PlainButtonStyle())
                            .background(
                                Circle()
                                    .fill(Color.black.opacity(0.6))
                                    .frame(width: 16, height: 16)
                            )
                        }
                        Spacer()
                    }
                    .padding(2)
                }
            } else {
                Circle()
                    .fill(Color.black.opacity(0.1))
                    .frame(width: 8, height: 8)
            }
        }
    }
}