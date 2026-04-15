struct ShelfItem: Identifiable {
    let id = UUID()
    let name: String
    let type: ItemType
    let dateAdded: Date
    let content: String
    
    enum ItemType {
        case file
        case image
        case url
        case text
    }
}

struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(name: "Meeting Notes", type: .text, dateAdded: Date().addingTimeInterval(-3600), content: "Quarterly review discussion points..."),
        ShelfItem(name: "Design.sketch", type: .file, dateAdded: Date().addingTimeInterval(-86400 * 2), content: ""),
        ShelfItem(name: "Inspiration", type: .image, dateAdded: Date().addingTimeInterval(-86400 * 5), content: ""),
        ShelfItem(name: "Linear", type: .url, dateAdded: Date().addingTimeInterval(-86400 * 10), content: "linear.app")
    ]
    
    @State private var dragOver: Int? = nil
    @State private var breathingOffset: Double = 0.0
    
    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<8, id: \.self) { index in
                ShelfSlot(
                    item: index < items.count ? items[index] : nil,
                    isDropTarget: dragOver == index,
                    breathingOffset: breathingOffset
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
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(
                    LinearGradient(
                        stops: [
                            .init(color: Color(red: 0.22, green: 0.18, blue: 0.12), location: 0.0),
                            .init(color: Color(red: 0.28, green: 0.23, blue: 0.16), location: 0.5),
                            .init(color: Color(red: 0.20, green: 0.16, blue: 0.11), location: 1.0)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color(red: 0.35, green: 0.28, blue: 0.20), lineWidth: 0.5)
                )
        )
        .onAppear {
            withAnimation(.easeInOut(duration: 3.0).repeatForever(autoreverses: true)) {
                breathingOffset = 2.0
            }
        }
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
    let breathingOffset: Double
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(
                    RadialGradient(
                        stops: [
                            .init(color: Color(red: 0.32, green: 0.26, blue: 0.18), location: 0.0),
                            .init(color: Color(red: 0.25, green: 0.20, blue: 0.14), location: 0.7),
                            .init(color: Color(red: 0.18, green: 0.14, blue: 0.10), location: 1.0)
                        ],
                        center: .center,
                        startRadius: 5,
                        endRadius: 45
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(
                            LinearGradient(
                                stops: [
                                    .init(color: Color(red: 0.45, green: 0.36, blue: 0.25), location: 0.0),
                                    .init(color: Color(red: 0.20, green: 0.16, blue: 0.11), location: 1.0)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 1
                        )
                )
                .overlay(
                    Rectangle()
                        .fill(
                            LinearGradient(
                                stops: [
                                    .init(color: Color(red: 0.35, green: 0.28, blue: 0.20).opacity(0.3), location: 0.0),
                                    .init(color: Color.clear, location: 0.3)
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .mask(RoundedRectangle(cornerRadius: 7))
                )
                .frame(width: 72, height: 72)
                .scaleEffect(isDropTarget ? 1.05 : 1.0)
                .offset(y: item == nil ? breathingOffset * 0.5 : 0)
                .animation(.spring(response: 0.4, dampingFraction: 0.6), value: isDropTarget)
            
            if let item = item {
                ItemPreview(item: item)
            } else {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 20))
                    .foregroundColor(Color(red: 0.45, green: 0.36, blue: 0.25))
                    .opacity(0.4)
            }
        }
        .overlay(
            itemGlow(for: item),
            alignment: .center
        )
    }
    
    @ViewBuilder
    private func itemGlow(for item: ShelfItem?) -> some View {
        if let item = item {
            let age = Date().timeIntervalSince(item.dateAdded)
            let glowColor: Color
            let glowOpacity: Double
            
            if age < 86400 {
                glowColor = Color(red: 1.0, green: 0.6, blue: 0.2)
                glowOpacity = 0.6
            } else if age < 259200 {
                glowColor = Color(red: 1.0, green: 0.7, blue: 0.3)
                glowOpacity = 0.3
            } else if age < 604800 {
                glowColor = Color(red: 0.8, green: 0.6, blue: 0.4)
                glowOpacity = 0.2
            } else {
                glowColor = Color.clear
                glowOpacity = 0.0
            }
            
            RoundedRectangle(cornerRadius: 8)
                .stroke(glowColor, lineWidth: 1)
                .opacity(glowOpacity)
                .frame(width: 72, height: 72)
        }
    }
}

struct ItemPreview: View {
    let item: ShelfItem
    
    var body: some View {
        VStack(spacing: 4) {
            iconForItem()
                .font(.system(size: 24))
                .foregroundColor(colorForAge())
            
            Text(item.name)
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundColor(colorForAge())
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .frame(width: 60)
        }
        .opacity(opacityForAge())
    }
    
    @ViewBuilder
    private func iconForItem() -> some View {
        switch item.type {
        case .file:
            Image(systemName: "doc.fill")
        case .image:
            Image(systemName: "photo.fill")
        case .url:
            Image(systemName: "link")
        case .text:
            Image(systemName: "text.alignleft")
        }
    }
    
    private func colorForAge() -> Color {
        let age = Date().timeIntervalSince(item.dateAdded)
        
        if age < 86400 {
            return Color(red: 1.0, green: 0.9, blue: 0.7)
        } else if age < 259200 {
            return Color(red: 0.9, green: 0.8, blue: 0.7)
        } else if age < 604800 {
            return Color(red: 0.7, green: 0.6, blue: 0.5)
        } else {
            return Color(red: 0.5, green: 0.4, blue: 0.3)
        }
    }
    
    private func opacityForAge() -> Double {
        let age = Date().timeIntervalSince(item.dateAdded)
        return age > 604800 ? 0.4 : 1.0
    }
}