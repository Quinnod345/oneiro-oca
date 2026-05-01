struct ContentView: View {
    @State private var items: [ShelfItem?] = Array(repeating: nil, count: 8)
    @State private var draggedItem: ShelfItem? = nil
    @State private var activeSlot: Int = 0
    @State private var lastInteractionTime = Date()
    
    private let maxSlots = 8
    private let storageURL = FileManager.default
        .urls(for: .applicationSupportDirectory, in: .userDomainMask)
        .first?
        .appendingPathComponent("DecayShelf")
        .appendingPathComponent("items.json")
    
    var body: some View {
        VStack(spacing: 32) {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Library Shelf")
                        .font(.title2)
                        .fontWeight(.semibold)
                        .foregroundStyle(.primary)
                    
                    Text("Tap empty slots to add items, filled slots to remove")
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
                    .background(
                        Capsule()
                            .fill(Material.thick)
                            .stroke(.quaternary, lineWidth: 0.5)
                    )
            }
            .padding(.horizontal, 28)
            
            VStack(spacing: 20) {
                LazyVGrid(columns: gridColumns, spacing: 20) {
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
                .padding(28)
                .background(
                    RoundedRectangle(cornerRadius: 20)
                        .fill(Material.sidebar)
                        .stroke(.quaternary.opacity(0.5), lineWidth: 1)
                        .shadow(color: .black.opacity(0.05), radius: 10, x: 0, y: 5)
                )
                .padding(.horizontal, 28)
            }
        }
        .frame(maxWidth: 720, maxHeight: 360)
        .background(
            LinearGradient(
                colors: [.blue.opacity(0.02), .purple.opacity(0.02)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .onAppear {
            loadItems()
            startActiveSlotCycle()
        }
        .onChange(of: items) { _, _ in
            saveItems()
            lastInteractionTime = Date()
        }
    }
    
    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(minimum: 140), spacing: 20), count: 4)
    }
    
    private func handleDrop(_ item: ShelfItem, at index: Int) {
        let staggerDelay = items[index] == nil ? 0.0 : 0.1
        
        withAnimation(.interpolatingSpring(stiffness: 300, damping: 20).delay(staggerDelay)) {
            if let existingIndex = items.firstIndex(where: { $0?.id == item.id }) {
                items[existingIndex] = nil
            }
            items[index] = item
            draggedItem = nil
            activeSlot = index
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            withAnimation(.interpolatingSpring(stiffness: 200, damping: 15)) {
                if activeSlot == index {
                    activeSlot = (activeSlot + 1) % maxSlots
                }
            }
        }
    }
    
    private func removeItem(at index: Int) {
        withAnimation(.interpolatingSpring(stiffness: 400, damping: 18)) {
            items[index] = nil
            if activeSlot == index {
                activeSlot = items.indices.first { items[$0] != nil } ?? 0
            }
        }
    }
    
    private func startActiveSlotCycle() {
        Timer.scheduledTimer(withTimeInterval: 2.5, repeats: true) { _ in
            guard Date().timeIntervalSince(lastInteractionTime) > 3.0 else { return }
            
            let occupiedSlots = items.indices.filter { items[$0] != nil }
            guard !occupiedSlots.isEmpty else { return }
            
            withAnimation(.interpolatingSpring(stiffness: 250, damping: 18)) {
                activeSlot = occupiedSlots.randomElement() ?? activeSlot
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
            
            for (offset, item) in loadedItems.prefix(maxSlots).enumerated() {
                if offset < maxSlots {
                    items[offset] = item
                }
            }
        } catch {
            // Silent failure
        }
    }
}