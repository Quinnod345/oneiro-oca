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
        VStack(spacing: 16) {
            HStack {
                Text("Library Shelf")
                    .font(.title2)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)
                
                Spacer()
                
                Text("\(items.compactMap { $0 }.count) of \(maxSlots)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Material.ultraThinMaterial, in: Capsule())
            }
            .padding(.horizontal, 20)
            
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(140), spacing: 12), count: 4), spacing: 12) {
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
            .padding(20)
            .background(Material.sidebar, in: RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 20)
        }
        .frame(width: 620, height: 280)
        .background(Material.windowBackground.opacity(0.8))
        .onAppear {
            loadItems()
            startActiveSlotRotation()
        }
        .onChange(of: items) { _, _ in
            saveItems()
        }
    }
    
    private func handleDrop(_ item: ShelfItem, at index: Int) {
        withAnimation(.easeInOut(duration: 0.3)) {
            if let existingIndex = items.firstIndex(where: { $0?.id == item.id }) {
                items[existingIndex] = nil
            }
            items[index] = item
            draggedItem = nil
        }
    }
    
    private func removeItem(at index: Int) {
        withAnimation(.easeInOut(duration: 0.2)) {
            items[index] = nil
        }
    }
    
    private func startActiveSlotRotation() {
        Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
            withAnimation(.easeInOut(duration: 0.5)) {
                activeSlot = (activeSlot + 1) % maxSlots
            }
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