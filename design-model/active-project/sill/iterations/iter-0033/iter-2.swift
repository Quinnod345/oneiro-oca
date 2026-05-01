struct ContentView: View {
    @State private var shelfItems: [ShelfItem] = []
    @State private var isHoveringClear = false
    @State private var isDragActive = false
    private let maxSlots: Int = 8
    private let documentsURL: URL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
    
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "square.stack.3d.down.right")
                    .font(.title3)
                    .foregroundStyle(.tint)
                
                Text("Temporal Shelf")
                    .font(.headline)
                    .foregroundColor(.primary)
                
                Spacer()
                
                Button(action: clearExpiredItems) {
                    Image(systemName: "wind")
                        .font(.title3)
                        .foregroundColor(.secondary)
                }
                .buttonStyle(PlainButtonStyle())
                .scaleEffect(isHoveringClear ? 1.15 : 1.0)
                .animation(.easeOut(duration: 0.2), value: isHoveringClear)
                .onHover { hovering in
                    isHoveringClear = hovering
                }
                .help("Clear aged items")
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 12)
            
            DragHandleView()
                .padding(.bottom, 8)
            
            ZStack {
                RoundedRectangle(cornerRadius: 16)
                    .fill(.regularMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(.quaternary, lineWidth: 0.5)
                    )
                
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(96), spacing: 16), count: 4), spacing: 16) {
                    ForEach(0..<maxSlots, id: \.self) { index in
                        if index < shelfItems.count {
                            ShelfItemView(item: shelfItems[index], index: index, isDragActive: isDragActive)
                        } else {
                            EmptySlotView(index: index, isDragActive: isDragActive)
                        }
                    }
                }
                .padding(20)
            }
            .frame(width: 440, height: 240)
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
        .frame(width: 480, height: 320)
        .background(.ultraThinMaterial)
        .onDrop(of: ["public.file-url"], isTargeted: nil) { providers in
            isDragActive = false
            return handleDrop(providers: providers)
        }
        .onAppear {
            loadItems()
        }
    }
    
    private func handleDrop(providers: [NSItemProvider]) -> Bool {
        guard shelfItems.count < maxSlots else { return false }
        
        for provider in providers {
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                if let url = url, url.isFileURL {
                    DispatchQueue.main.async {
                        addItem(from: url)
                    }
                }
            }
        }
        return true
    }
    
    private func addItem(from url: URL) {
        guard shelfItems.count < maxSlots else { return }
        
        let fileName = url.lastPathComponent
        let newItem = ShelfItem(
            filePath: url.path,
            fileName: fileName,
            addedDate: Date()
        )
        
        withAnimation(.easeIn(duration: 0.3)) {
            shelfItems.append(newItem)
        }
        saveItems()
    }
    
    private func clearExpiredItems() {
        let itemsToRemove = shelfItems.enumerated().compactMap { index, item in
            item.ageInDays > 7 ? index : nil
        }.reversed()
        
        for index in itemsToRemove {
            withAnimation(.easeOut(duration: 0.4).delay(Double(index) * 0.1)) {
                if index < shelfItems.count {
                    shelfItems.remove(at: index)
                }
            }
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            saveItems()
        }
    }
    
    private func saveItems() {
        let saveURL = documentsURL.appendingPathComponent("shelf_items.json")
        do {
            let data = try JSONEncoder().encode(shelfItems)
            try data.write(to: saveURL)
        } catch {
            // Silent fail for this prototype
        }
    }
    
    private func loadItems() {
        let loadURL = documentsURL.appendingPathComponent("shelf_items.json")
        do {
            let data = try Data(contentsOf: loadURL)
            shelfItems = try JSONDecoder().decode([ShelfItem].self, from: data)
        } catch {
            // Silent fail - start with empty shelf
        }
    }
}

struct DragHandleView: View {
    @State private var dragOffset: CGSize = .zero
    @State private var isDragging = false
    
    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<6, id: \.self) { _ in
                Circle()
                    .fill(.tertiary)
                    .frame(width: 3, height: 3)
            }
        }
        .scaleEffect(isDragging ? 1.2 : 1.0)
        .animation(.easeInOut(duration: 0.2), value: isDragging)
        .offset(dragOffset)
        .gesture(
            DragGesture()
                .onChanged { value in
                    isDragging = true
                    dragOffset = value.translation
                    
                    if let window = NSApp.keyWindow {
                        let newOrigin = CGPoint(
                            x: window.frame.origin.x + value.translation.x,
                            y: window.frame.origin.y - value.translation.y
                        )
                        window.setFrameOrigin(newOrigin)
                    }
                }
                .onEnded { _ in
                    isDragging = false
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                        dragOffset = .zero
                    }
                }
        )
    }
}

struct ShelfItemView: View {
    let item: ShelfItem
    let index: Int
    let isDragActive: Bool
    @State private var isHovering = false
    @State private var opacity: Double = 0
    
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "doc.fill")
                .font(.title3)
                .foregroundStyle(
                    LinearGradient(
                        colors: [item.ageColor, item.ageColor.opacity(0.7)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
            
            Text(item.fileName)
                .font(.caption)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .foregroundColor(.primary)
                .truncationMode(.middle)
            
            Text("\(item.ageInDays)d")
                .font(.caption2)
                .fontWeight(.medium)
                .fontDesign(.monospaced)
                .foregroundColor(.secondary)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(item.ageColor.opacity(0.2))
                .cornerRadius(4)
        }
        .frame(width: 96, height: 96)
        .background(.regularMaterial)
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(isHovering ? item.ageColor.opacity(0.5) : .clear, lineWidth: 1)
        )
        .scaleEffect(isHovering ? 1.05 : 1.0)
        .opacity(opacity)
        .animation(.easeInOut(duration: 0.2), value: isHovering)
        .onHover { hovering in
            isHovering = hovering
        }
        .onAppear {
            withAnimation(.easeIn(duration: 0.3).delay(Double(index) * 0.1)) {
                opacity = 1
            }
        }
        .onDisappear {
            withAnimation(.easeOut(duration: 0.2)) {
                opacity = 0
            }
        }
    }
}

struct EmptySlotView: View {
    let index: Int
    let isDragActive: Bool
    
    var body: some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(.quaternary.opacity(0.3))
            .frame(width: 96, height: 96)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(.quaternary, lineWidth: 1)
                    .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
            )
            .scaleEffect(isDragActive ? 1.05 : 1.0)
            .animation(.spring(response: 0.4, dampingFraction: 0.7), value: isDragActive)
    }
}