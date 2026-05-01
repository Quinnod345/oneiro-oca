struct ContentView: View {
    @State private var shelfItems: [ShelfItem] = []
    @State private var isHoveringClear = false
    @State private var dragOffset: CGSize = .zero
    @State private var isDragActive = false
    private let maxSlots: Int = 8
    private let documentsURL: URL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
    
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Temporal Shelf")
                    .font(.headline)
                    .foregroundColor(.primary)
                
                Spacer()
                
                Button(action: clearExpiredItems) {
                    Image(systemName: "wind")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .buttonStyle(PlainButtonStyle())
                .scaleEffect(isHoveringClear ? 1.1 : 1.0)
                .animation(.easeInOut(duration: 0.15), value: isHoveringClear)
                .onHover { hovering in
                    isHoveringClear = hovering
                }
                .help("Clear aged items")
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 8)
            
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.regularMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(.quaternary, lineWidth: 0.5)
                    )
                    .shadow(color: .black.opacity(0.1), radius: 8, x: 0, y: 4)
                
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(80), spacing: 12), count: 4), spacing: 12) {
                    ForEach(0..<maxSlots, id: \.self) { index in
                        if index < shelfItems.count {
                            ShelfItemView(item: shelfItems[index], index: index, isDragActive: isDragActive)
                        } else {
                            EmptySlotView(index: index, isDragActive: isDragActive)
                        }
                    }
                }
                .padding(16)
                .scaleEffect(isDragActive ? 1.02 : 1.0)
                .opacity(isDragActive ? 0.9 : 1.0)
                .animation(.spring(response: 0.4, dampingFraction: 0.8), value: isDragActive)
            }
            .frame(width: 400, height: 200)
            .padding(.horizontal, 20)
            .padding(.bottom, 16)
        }
        .frame(width: 440, height: 260)
        .background(.ultraThinMaterial)
        .offset(dragOffset)
        .onDrop(of: ["public.file-url"], isTargeted: nil) { providers in
            isDragActive = false
            return handleDrop(providers: providers)
        }
        .onAppear {
            loadItems()
        }
        .gesture(
            DragGesture()
                .onChanged { value in
                    isDragActive = true
                    dragOffset = value.translation
                }
                .onEnded { _ in
                    isDragActive = false
                    withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                        dragOffset = .zero
                    }
                }
        )
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
        
        let fileName: String = url.lastPathComponent
        let newItem: ShelfItem = ShelfItem(
            filePath: url.path,
            fileName: fileName,
            addedDate: Date()
        )
        
        withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
            shelfItems.append(newItem)
        }
        saveItems()
    }
    
    private func clearExpiredItems() {
        withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
            shelfItems.removeAll { $0.ageInDays > 7 }
        }
        saveItems()
    }
    
    private func saveItems() {
        let saveURL: URL = documentsURL.appendingPathComponent("shelf_items.json")
        do {
            let data: Data = try JSONEncoder().encode(shelfItems)
            try data.write(to: saveURL)
        } catch {
            // Silent fail for this prototype
        }
    }
    
    private func loadItems() {
        let loadURL: URL = documentsURL.appendingPathComponent("shelf_items.json")
        do {
            let data: Data = try Data(contentsOf: loadURL)
            shelfItems = try JSONDecoder().decode([ShelfItem].self, from: data)
        } catch {
            // Silent fail - start with empty shelf
        }
    }
}

struct ShelfItemView: View {
    let item: ShelfItem
    let index: Int
    let isDragActive: Bool
    @State private var isHovering = false
    
    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: "doc.fill")
                .font(.title2)
                .foregroundColor(.accentColor)
            
            Text(item.fileName)
                .font(.caption2)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .foregroundColor(.primary)
            
            Text("\(item.ageInDays)d")
                .font(.caption2)
                .fontWeight(.medium)
                .fontDesign(.monospaced)
                .foregroundColor(.secondary)
        }
        .frame(width: 80, height: 80)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(.tertiary, lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.05), radius: 2, x: 0, y: 1)
        .scaleEffect(isHovering ? 1.05 : 1.0)
        .animation(.easeInOut(duration: 0.2), value: isHovering)
        .onHover { hovering in
            isHovering = hovering
        }
    }
}

struct EmptySlotView: View {
    let index: Int
    let isDragActive: Bool
    @State private var isHovering = false
    
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .stroke(.tertiary, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
            .frame(width: 80, height: 80)
            .background(.regularMaterial.opacity(0.3))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                Image(systemName: "plus")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .scaleEffect(isDragActive ? 1.2 : 0.8)
                    .animation(.easeInOut(duration: 0.2), value: isDragActive)
            )
            .scaleEffect(isHovering ? 1.02 : 1.0)
            .animation(.easeInOut(duration: 0.15), value: isHovering)
            .onHover { hovering in
                isHovering = hovering
            }
    }
}