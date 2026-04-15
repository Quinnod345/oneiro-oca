struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(name: "Meeting Notes", type: .text, dateAdded: Date().addingTimeInterval(-3600), content: "Quarterly review discussion points..."),
        ShelfItem(name: "Design.sketch", type: .file, dateAdded: Date().addingTimeInterval(-86400 * 2), content: ""),
        ShelfItem(name: "Inspiration", type: .image, dateAdded: Date().addingTimeInterval(-86400 * 5), content: ""),
        ShelfItem(name: "Linear", type: .url, dateAdded: Date().addingTimeInterval(-86400 * 10), content: "linear.app")
    ]
    
    @State private var dragOver: Int? = nil
    @State private var hoveredSlot: Int? = nil
    
    var body: some View {
        VStack(spacing: 20) {
            HStack {
                Text("Shelf")
                    .font(.system(size: 24, weight: .semibold, design: .default))
                    .foregroundColor(.primary)
                
                Spacer()
                
                Text("\(items.count) of 8 items")
                    .font(.system(size: 12, weight: .medium, design: .default))
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal, 20)
            
            HStack(spacing: 16) {
                ForEach(0..<8, id: \.self) { index in
                    ShelfSlot(
                        item: index < items.count ? items[index] : nil,
                        isDropTarget: dragOver == index,
                        isHovered: hoveredSlot == index
                    )
                    .scaleEffect(hoveredSlot == index ? 1.05 : 1.0)
                    .animation(.spring(response: 0.3, dampingFraction: 0.7), value: hoveredSlot)
                    .onHover { hovering in
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                            hoveredSlot = hovering ? index : nil
                        }
                    }
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
            .padding(.horizontal, 20)
        }
        .padding(.vertical, 24)
        .background(
            LinearGradient(
                colors: [.white.opacity(0.8), .white.opacity(0.95)],
                startPoint: .top,
                endPoint: .bottom
            ),
            in: RoundedRectangle(cornerRadius: 16)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(
                    LinearGradient(
                        colors: [.gray.opacity(0.2), .gray.opacity(0.1)],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    lineWidth: 1
                )
        )
        .shadow(color: .black.opacity(0.08), radius: 20, x: 0, y: 8)
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
        
        withAnimation(.spring(response: 0.6, dampingFraction: 0.7)) {
            if index < items.count {
                items[index] = newItem
            } else {
                items.append(newItem)
            }
            dragOver = nil
        }
    }
}

struct ShelfSlot: View {
    let item: ShelfItem?
    let isDropTarget: Bool
    let isHovered: Bool
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(backgroundGradient)
                .frame(width: 120, height: 120)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(borderGradient, lineWidth: 1)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(
                            LinearGradient(
                                colors: isDropTarget ? [.blue.opacity(0.8), .blue.opacity(0.4)] : [.clear],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: isDropTarget ? 3 : 0
                        )
                        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isDropTarget)
                )
                .shadow(
                    color: .black.opacity(isHovered || isDropTarget ? 0.15 : 0.06),
                    radius: isHovered || isDropTarget ? 12 : 6,
                    x: 0,
                    y: isHovered || isDropTarget ? 6 : 3
                )
                .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovered)
            
            if let item = item {
                VStack(spacing: 8) {
                    ZStack {
                        Circle()
                            .fill(item.type.backgroundGradient)
                            .frame(width: 40, height: 40)
                        
                        Image(systemName: item.type.iconName)
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundColor(item.type.iconColor)
                    }
                    
                    VStack(spacing: 2) {
                        Text(item.name)
                            .font(.system(size: 12, weight: .semibold, design: .default))
                            .foregroundColor(.primary)
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: 100)
                        
                        Text(timeAgoString(from: item.dateAdded))
                            .font(.system(size: 10, weight: .medium, design: .default))
                            .foregroundColor(.secondary)
                    }
                }
                .padding(12)
                .transition(.scale.combined(with: .opacity))
            } else {
                VStack(spacing: 8) {
                    if isDropTarget {
                        ZStack {
                            Circle()
                                .fill(
                                    LinearGradient(
                                        colors: [.blue.opacity(0.2), .blue.opacity(0.1)],
                                        startPoint: .top,
                                        endPoint: .bottom
                                    )
                                )
                                .frame(width: 40, height: 40)
                            
                            Image(systemName: "plus.circle.fill")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundColor(.blue)
                        }
                        
                        Text("Drop Here")
                            .font(.system(size: 12, weight: .semibold, design: .default))
                            .foregroundColor(.blue)
                    } else {
                        Image(systemName: "plus.dashed")
                            .font(.system(size: 24, weight: .medium))
                            .foregroundColor(.quaternary)
                        
                        Text("Empty")
                            .font(.system(size: 10, weight: .medium, design: .default))
                            .foregroundColor(.quaternary)
                    }
                }
                .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isDropTarget)
            }
        }
        .frame(width: 120, height: 120)
    }
    
    private var backgroundGradient: LinearGradient {
        if let item = item {
            return item.type.backgroundGradient.opacity(0.1)
        } else {
            return LinearGradient(
                colors: [.gray.opacity(0.05), .gray.opacity(0.1)],
                startPoint: .top,
                endPoint: .bottom
            )
        }
    }
    
    private var borderGradient: LinearGradient {
        LinearGradient(
            colors: [.gray.opacity(0.2), .gray.opacity(0.1)],
            startPoint: .top,
            endPoint: .bottom
        )
    }
    
    private func timeAgoString(from date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

extension ShelfItem.ItemType {
    var backgroundGradient: LinearGradient {
        switch self {
        case .text:
            return LinearGradient(colors: [.blue, .blue.opacity(0.7)], startPoint: .top, endPoint: .bottom)
        case .file:
            return LinearGradient(colors: [.purple, .purple.opacity(0.7)], startPoint: .top, endPoint: .bottom)
        case .image:
            return LinearGradient(colors: [.green, .green.opacity(0.7)], startPoint: .top, endPoint: .bottom)
        case .url:
            return LinearGradient(colors: [.orange, .orange.opacity(0.7)], startPoint: .top, endPoint: .bottom)
        }
    }
    
    var iconColor: Color {
        switch self {
        case .text: return .blue
        case .file: return .purple
        case .image: return .green
        case .url: return .orange
        }
    }
}