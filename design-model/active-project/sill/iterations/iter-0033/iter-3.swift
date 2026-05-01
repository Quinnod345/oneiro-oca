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
                .animation(.spring(duration: 0.25), value: isHoveringClear)
                .onHover { hovering in
                    isHoveringClear = hovering
                }
                .help("Clear aged items")
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 20)
            
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
        
        withAnimation(.spring(duration: 0.25)) {
            shelfItems.append(newItem)
        }
        saveItems()
    }
    
    private func clearExpiredItems() {
        let itemsToRemove = shelfItems.enumerated().compactMap { index, item in
            item.ageInDays > 7 ? index : nil
        }.reversed()
        
        for index in itemsToRemove {
            withAnimation(.spring(duration: 0.25).delay(Double(index) * 0.1)) {
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

struct ShelfItemView: View {
    let item: ShelfItem
    let index: Int
    let isDragActive: Bool
    @State private var isHovering = false
    
    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.thinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(.quaternary, lineWidth: 0.5)
                    )
                
                Image(systemName: fileIcon(for: item.fileName))
                    .font(.title)
                    .foregroundStyle(.tint)
                    .opacity(item.ageOpacity)
                    .saturation(item.ageOpacity)
            }
            .frame(width: 80, height: 64)
            
            Text(item.fileName)
                .font(.caption2)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .foregroundColor(.primary)
                .opacity(item.ageOpacity)
                .frame(width: 80)
        }
        .scaleEffect(isHovering ? 1.05 : 1.0)
        .animation(.spring(duration: 0.25), value: isHovering)
        .onHover { hovering in
            isHovering = hovering
        }
        .onTapGesture {
            openItem()
        }
    }
    
    private func fileIcon(for fileName: String) -> String {
        let ext = (fileName as NSString).pathExtension.lowercased()
        switch ext {
        case "pdf": return "doc.richtext"
        case "txt", "md": return "doc.text"
        case "jpg", "jpeg", "png", "gif": return "photo"
        case "mp4", "mov": return "video"
        case "mp3", "wav": return "music.note"
        case "zip", "rar": return "archivebox"
        default: return "doc"
        }
    }
    
    private func openItem() {
        let url = URL(fileURLWithPath: item.filePath)
        NSWorkspace.shared.open(url)
    }
}

struct EmptySlotView: View {
    let index: Int
    let isDragActive: Bool
    
    var body: some View {
        VStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 12)
                .fill(isDragActive ? .thinMaterial : .clear)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(.quaternary, lineWidth: isDragActive ? 1.0 : 0.5)
                        .animation(.spring(duration: 0.25), value: isDragActive)
                )
                .frame(width: 80, height: 64)
            
            Rectangle()
                .fill(.clear)
                .frame(width: 80, height: 20)
        }
    }
}