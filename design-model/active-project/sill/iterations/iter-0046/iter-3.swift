struct ContentView: View {
    @State private var items: [ShelfItem] = []
    @State private var hoveredSlot: Int? = nil
    @State private var decayTimer: Timer?
    
    let maxSlots: Int = 12
    let columns = Array(repeating: GridItem(.flexible(), spacing: 16), count: 4)
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                VisualEffectView(material: .underWindowBackground, blendingMode: .behindWindow)
                    .ignoresSafeArea()
                
                VStack(spacing: 16) {
                    Text("Temporal Shelf")
                        .font(.system(size: 24, weight: .light))
                        .foregroundColor(.primary)
                        .padding(.top, 20)
                    
                    LazyVGrid(columns: columns, spacing: 16) {
                        ForEach(0..<maxSlots, id: \.self) { index in
                            ShelfSlot(
                                item: index < items.count ? items[index] : nil,
                                index: index,
                                isHovered: hoveredSlot == index,
                                onDrop: handleDrop,
                                onHover: { isHovering in
                                    hoveredSlot = isHovering ? index : nil
                                },
                                onAction: { item in
                                    if item.type == .url {
                                        NSWorkspace.shared.open(URL(string: item.content)!)
                                    }
                                }
                            )
                        }
                    }
                    .padding(.horizontal, 20)
                    
                    Spacer()
                }
            }
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            addSampleItems()
            startDecayTimer()
        }
        .onDisappear {
            decayTimer?.invalidate()
        }
    }
    
    private func handleDrop(providers: [NSItemProvider], index: Int) -> Bool {
        for provider in providers {
            if provider.canLoadObject(ofClass: String.self) {
                provider.loadObject(ofClass: String.self) { string, error in
                    if let content = string {
                        DispatchQueue.main.async {
                            let isURL = content.contains("http")
                            
                            let newItem = ShelfItem(
                                content: content,
                                type: isURL ? .url : .text,
                                warmthTint: .gray,
                                saturation: 0.8,
                                opacity: 1.0,
                                decayProgress: 0.0,
                                importance: [.high, .medium, .low].randomElement() ?? .medium,
                                createdAt: Date()
                            )
                            
                            if index < items.count {
                                items[index] = newItem
                            } else {
                                items.append(newItem)
                            }
                        }
                    }
                }
                return true
            }
        }
        return false
    }
    
    private func addSampleItems() {
        let sampleData = [
            ("Critical system update", ShelfItem.ItemType.text, ShelfItem.ItemImportance.high),
            ("https://developer.apple.com", .url, .medium),
            ("Meeting notes", .text, .low),
            ("Project docs.pdf", .file, .medium),
            ("https://github.com", .url, .low),
            ("Bug report draft", .text, .high),
            ("Design mockups", .file, .medium),
            ("Code review", .text, .low)
        ]
        
        items = sampleData.enumerated().map { index, data in
            ShelfItem(
                content: data.0,
                type: data.1,
                warmthTint: .gray,
                saturation: 0.8,
                opacity: 1.0,
                decayProgress: 0.0,
                importance: data.2,
                createdAt: Date().addingTimeInterval(-Double(index * 60))
            )
        }
    }
    
    private func startDecayTimer() {
        decayTimer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: true) { _ in
            withAnimation(.easeInOut(duration: 1.0)) {
                items = items.map { $0 }
            }
        }
    }
}

struct ShelfSlot: View {
    let item: ShelfItem?
    let index: Int
    let isHovered: Bool
    let onDrop: ([NSItemProvider], Int) -> Bool
    let onHover: (Bool) -> Void
    let onAction: (ShelfItem) -> Void
    
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(backgroundColor)
            .frame(width: 300, height: 120)
            .overlay(
                VStack(spacing: 8) {
                    if let item = item {
                        HStack {
                            Circle()
                                .fill(item.itemColor)
                                .frame(width: 8, height: 8)
                                .opacity(item.decayedOpacity)
                                .saturation(item.decayedSaturation)
                            
                            Text(item.content)
                                .font(.system(size: 12, weight: .medium))
                                .lineLimit(3)
                                .multilineTextAlignment(.leading)
                                .foregroundColor(.primary)
                                .opacity(item.decayedOpacity)
                            
                            Spacer()
                        }
                        
                        HStack {
                            Text(item.type == .url ? "URL" : item.type == .file ? "FILE" : "TEXT")
                                .font(.system(size: 9, weight: .light))
                                .foregroundColor(.secondary)
                            
                            Spacer()
                            
                            Text("\(Int(item.ageInMinutes))m ago")
                                .font(.system(size: 9, weight: .light))
                                .foregroundColor(.secondary)
                        }
                    } else {
                        Text("Drop here")
                            .font(.system(size: 11, weight: .light))
                            .foregroundColor(.secondary)
                    }
                }
                .padding(12)
            )
            .onDrop(of: [.text], isTargeted: nil) { providers in
                onDrop(providers, index)
            }
            .onHover(perform: onHover)
            .onTapGesture {
                if let item = item {
                    onAction(item)
                }
            }
            .scaleEffect(isHovered ? 1.02 : 1.0)
            .animation(.easeInOut(duration: 0.2), value: isHovered)
    }
    
    private var backgroundColor: Color {
        if isHovered {
            return Color.primary.opacity(0.08)
        } else if item != nil {
            return Color.primary.opacity(0.04)
        } else {
            return Color.primary.opacity(0.02)
        }
    }
}

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = blendingMode
        return view
    }
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}