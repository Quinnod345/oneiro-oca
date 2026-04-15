struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(title: "Design System.sketch", addedAt: Date().addingTimeInterval(-3600), contentType: .file, preview: "doc.text"),
        ShelfItem(title: "Meeting Notes", addedAt: Date().addingTimeInterval(-86400), contentType: .text, preview: "Key decisions from quarterly planning session"),
        ShelfItem(title: "Sunset.jpg", addedAt: Date().addingTimeInterval(-172800), contentType: .image, preview: "photo"),
        ShelfItem(title: "API Documentation", addedAt: Date().addingTimeInterval(-259200), contentType: .text, preview: "REST endpoints for user management"),
        ShelfItem(title: "Prototype.fig", addedAt: Date().addingTimeInterval(-432000), contentType: .file, preview: "paintbrush"),
        ShelfItem(title: "Old Script", addedAt: Date().addingTimeInterval(-518400), contentType: .file, preview: "applescript")
    ]
    
    @State private var draggedItem: ShelfItem?
    
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.95, green: 0.94, blue: 0.92),
                    Color(red: 0.92, green: 0.90, blue: 0.88)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            
            VStack(spacing: 0) {
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(red: 0.4, green: 0.2, blue: 0.1).opacity(0.8),
                                Color(red: 0.3, green: 0.15, blue: 0.08).opacity(0.9)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .frame(height: 12)
                    .shadow(color: .black.opacity(0.3), radius: 2, x: 0, y: 2)
                
                HStack(spacing: 4) {
                    ForEach(Array(items.prefix(8).enumerated()), id: \.element.id) { index, item in
                        ShelfSlotView(item: item, items: $items, draggedItem: $draggedItem)
                    }
                    
                    ForEach(0..<max(0, 8 - items.count), id: \.self) { _ in
                        EmptySlotView()
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
                .modifier(ShelfMaterial())
            }
        }
        .frame(minWidth: 1040, minHeight: 200)
    }
}

struct ShelfSlotView: View {
    let item: ShelfItem
    @Binding var items: [ShelfItem]
    @Binding var draggedItem: ShelfItem?
    @State private var isHovered = false
    @State private var showContextMenu = false
    @State private var dragOffset = CGSize.zero
    @State private var isDragging = false
    
    private var ageInDays: Double {
        Date().timeIntervalSince(item.addedAt) / 86400
    }
    
    private var isRecent: Bool {
        ageInDays < 1
    }
    
    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.9),
                                Color.gray.opacity(0.1)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 120, height: 120)
                    .shadow(
                        color: .black.opacity(isDragging ? 0.25 : 0.1),
                        radius: isDragging ? 12 : 3,
                        x: 0,
                        y: isDragging ? 6 : 2
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(
                                LinearGradient(
                                    colors: [
                                        Color.white.opacity(0.6),
                                        Color.gray.opacity(0.2)
                                    ],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                lineWidth: 1
                            )
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.blue.opacity(isHovered ? 0.4 : 0), lineWidth: 2)
                    )
                
                Group {
                    if item.contentType == .text {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Image(systemName: "text.alignleft")
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundColor(.secondary)
                                Spacer()
                            }
                            Text(item.preview)
                                .font(.system(.caption, design: .default, weight: .regular))
                                .foregroundColor(.primary)
                                .lineLimit(6)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(12)
                    } else {
                        VStack(spacing: 4) {
                            Image(systemName: item.preview)
                                .font(.system(size: 32, weight: .light))
                                .foregroundColor(.primary)
                            
                            if item.contentType == .image {
                                Text("JPG")
                                    .font(.system(.caption2, weight: .medium))
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                }
                
                if isRecent {
                    VStack {
                        HStack {
                            Spacer()
                            Circle()
                                .fill(Color.orange)
                                .frame(width: 8, height: 8)
                                .shadow(color: .orange.opacity(0.6), radius: 2)
                                .padding(.trailing, 10)
                                .padding(.top, 10)
                        }
                        Spacer()
                    }
                }
            }
            .scaleEffect(isHovered && !isDragging ? 1.05 : isDragging ? 1.08 : 1.0)
            .rotationEffect(.degrees(isDragging ? 2 : 0))
            .offset(dragOffset)
            .zIndex(isDragging ? 1 : 0)
            
            Text(item.title)
                .font(.system(.caption, design: .default, weight: .medium))
                .foregroundColor(.primary)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .frame(width: 120, height: 32)
        }
        .onHover { hovering in
            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                isHovered = hovering
            }
        }
        .simultaneousGesture(
            DragGesture(coordinateSpace: .global)
                .onChanged { value in
                    if !isDragging {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                            isDragging = true
                            draggedItem = item
                        }
                    }
                    dragOffset = value.translation
                }
                .onEnded { value in
                    withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                        isDragging = false
                        dragOffset = .zero
                        draggedItem = nil
                    }
                    
                    if abs(value.translation.x) > 60 {
                        let moveRight = value.translation.x > 0
                        reorderItems(moveRight: moveRight)
                    }
                }
        )
        .onTapGesture(count: 2) {
            openItem()
        }
        .contextMenu {
            Button("Open") {
                openItem()
            }
            Button("Move to Trash") {
                withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                    removeItem()
                }
            }
            Divider()
            Button("Show Info") {
                showInfo()
            }
        }
    }
    
    private func reorderItems(moveRight: Bool) {
        guard let currentIndex = items.firstIndex(where: { $0.id == item.id }) else { return }
        let newIndex = moveRight ? min(currentIndex + 1, items.count - 1) : max(currentIndex - 1, 0)
        
        if newIndex != currentIndex {
            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                items.move(fromOffsets: IndexSet(integer: currentIndex), toOffset: newIndex > currentIndex ? newIndex + 1 : newIndex)
            }
        }
    }
    
    private func removeItem() {
        items.removeAll { $0.id == item.id }
    }
    
    private func openItem() {
        print("Opening \(item.title)")
    }
    
    private func showInfo() {
        print("Showing info for \(item.title)")
    }
}

struct EmptySlotView: View {
    var body: some View {
        VStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 8)
                .stroke(
                    Color.gray.opacity(0.3),
                    style: StrokeStyle(lineWidth: 1.5, dash: [8, 4])
                )
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.white.opacity(0.3))
                )
                .frame(width: 120, height: 120)
            
            Text("")
                .font(.system(.caption, weight: .medium))
                .frame(width: 120, height: 32)
        }
    }
}

struct ShelfItem: Identifiable, Equatable {
    let id = UUID()
    let title: String
    let addedAt: Date
    let contentType: ContentType
    let preview: String
    
    enum ContentType {
        case text, image, file
    }
}