struct ContentView: View {
    @State private var items: [ShelfItem?] = Array(repeating: nil, count: 8)
    @State private var draggedItem: ShelfItem? = nil
    @State private var activeSlot: Int = 0
    
    private let maxSlots = 8
    private let storageURL = FileManager.default
        .urls(for: .applicationSupportDirectory, in: .userDomainMask)
        .first?
        .appendingPathComponent("DecayShelf")
        .appendingPathComponent("items.json")
    
    var body: some View {
        VStack(spacing: 24) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Library Shelf")
                        .font(.title2)
                        .fontWeight(.semibold)
                        .foregroundStyle(.primary)
                    
                    Text("Drop items to organize your collection")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                
                Spacer()
                
                Text("\(items.compactMap { $0 }.count) of \(maxSlots)")
                    .font(.system(.caption, design: .monospaced))
                    .fontWeight(.medium)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Material.thickMaterial, in: Capsule())
            }
            .padding(.horizontal, 24)
            
            LazyVGrid(columns: gridColumns, spacing: 16) {
                ForEach(0..<maxSlots, id: \.self) { index in
                    ShelfSlot(
                        index: index,
                        item: items[index],
                        isActive: index == activeSlot,
                        draggedItem: $draggedItem,
                        onDrop: handleDrop,
                        onRemove: removeItem
                    )
                }
            }
            .padding(24)
            .background(Material.sidebar, in: RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal, 24)
        }
        .frame(maxWidth: 680, maxHeight: 320)
        .background(Material.windowBackground)
        .onAppear {
            loadItems()
        }
        .onChange(of: items) { _, _ in
            saveItems()
        }
        .onTapGesture {
            withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
                activeSlot = Int.random(in: 0..<maxSlots)
            }
        }
    }
    
    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(minimum: 120), spacing: 16), count: 4)
    }
    
    private func handleDrop(_ item: ShelfItem, at index: Int) {
        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
            if let existingIndex = items.firstIndex(where: { $0?.id == item.id }) {
                items[existingIndex] = nil
            }
            items[index] = item
            draggedItem = nil
            activeSlot = index
        }
    }
    
    private func removeItem(at index: Int) {
        withAnimation(.spring(response: 0.4, dampingFraction: 0.9)) {
            items[index] = nil
        }
    }
    
    private func saveItems() {
        guard let url = storageURL else { return }
        
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            
            let data = try JSONEncoder().encode(items.compactMap { $0 })
            try data.write(to: url)
        } catch {
            // Silent failure
        }
    }
    
    private func loadItems() {
        guard let url = storageURL,
              FileManager.default.fileExists(atPath: url.path) else { return }
        
        do {
            let data = try Data(contentsOf: url)
            let loadedItems = try JSONDecoder().decode([ShelfItem].self, from: data)
            
            for item in loadedItems.prefix(maxSlots) {
                if let index = items.firstIndex(where: { $0 == nil }) {
                    items[index] = item
                }
            }
        } catch {
            // Silent failure
        }
    }
}