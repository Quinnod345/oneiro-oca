struct ContentView: View {
    @State private var items: [ShelfItem] = []
    @State private var hoveredSlot: Int? = nil
    @State private var decayTimer: Timer?
    
    let maxSlots: Int = 8
    let shelfPadding: Double = 32
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                VisualEffectView(material: .underWindowBackground, blendingMode: .behindWindow)
                    .ignoresSafeArea()
                
                VStack(spacing: 24) {
                    Text("Temporal Shelf")
                        .font(.system(size: 28, weight: .light, design: .default))
                        .foregroundColor(.primary)
                        .padding(.top, 40)
                    
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 20) {
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
                        .padding(.horizontal, shelfPadding)
                    }
                    
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
                            let warmthColors: [Color] = [.orange, .red, .pink, .purple, .blue, .teal]
                            
                            let newItem = ShelfItem(
                                content: content,
                                type: isURL ? .url : .text,
                                warmthTint: warmthColors.randomElement() ?? .orange,
                                saturation: Double.random(in: 0.7...1.0),
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
        let warmthColors: [Color] = [.orange, .red, .pink, .purple, .blue, .teal]
        let sampleData = [
            ("Critical system update available", ShelfItem.ItemType.text, ShelfItem.ItemImportance.high),
            ("https://developer.apple.com/swiftui", .url, .medium),
            ("Meeting notes from yesterday", .text, .low),
            ("Project documentation.pdf", .file, .medium),
            ("https://github.com/trending", .url, .low)
        ]
        
        items = sampleData.enumerated().map { index, data in
            ShelfItem(
                content: data.0,
                type: data.1,
                warmthTint: warmthColors[index % warmthColors.count],
                saturation: Double.random(in: 0.8...1.0),
                opacity: 1.0,
                decayProgress: 0.0,
                importance: data.2,
                createdAt: Date().addingTimeInterval(-Double(index * 30))
            )
        }
    }
    
    private func startDecayTimer() {
        decayTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
            // Force UI update to show decay progress
            items = items.map { $0 }
        }
    }
}