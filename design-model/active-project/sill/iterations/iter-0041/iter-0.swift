struct ContentView: View {
    @State private var items: [ShelfItem?] = Array(repeating: nil, count: 8)
    @State private var draggedItem: ShelfItem? = nil
    @State private var pulsePhase: Double = 0
    @State private var activeSlot: Int = 0
    
    private let maxSlots = 8
    private let storageURL = FileManager.default
        .urls(for: .applicationSupportDirectory, in: .userDomainMask)
        .first?
        .appendingPathComponent("DecayShelf")
        .appendingPathComponent("items.json")
    
    var body: some View {
        VStack(spacing: 0) {
            // Shelf header
            HStack {
                Text("TEMPORAL SHELF")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundColor(Color(red: 0.7, green: 0.6, blue: 0.5))
                    .tracking(2)
                
                Spacer()
                
                Text("\(items.compactMap { $0 }.count)/\(maxSlots)")
                    .font(.system(size: 10, weight: .light, design: .monospaced))
                    .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            
            // Main shelf area
            ZStack {
                // Shelf background
                RoundedRectangle(cornerRadius: 12)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(red: 0.08, green: 0.06, blue: 0.04),
                                Color(red: 0.12, green: 0.10, blue: 0.08)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(
                                Color(red: 0.25, green: 0.20, blue: 0.15).opacity(0.4),
                                lineWidth: 1
                            )
                    )
                
                // Wood grain effect
                RoundedRectangle(cornerRadius: 12)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(red: 0.18, green: 0.14, blue: 0.10).opacity(0.3),
                                Color.clear,
                                Color(red: 0.22, green: 0.18, blue: 0.14).opacity(0.2)
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .blendMode(.multiply)
                
                // Slots grid
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(140), spacing: 8), count: 4), spacing: 8) {
                    ForEach(0..<maxSlots, id: \.self) { index in
                        ShelfSlot(
                            index: index,
                            item: items[index],
                            isActive: index == activeSlot,
                            pulsePhase: pulsePhase,
                            draggedItem: $draggedItem,
                            onDrop: handleDrop,
                            onRemove: removeItem
                        )
                    }
                }
                .padding(16)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .frame(width: 620, height: 280)
        .background(
            Color(red: 0.05, green: 0.04, blue: 0.03)
                .ignoresSafeArea()
        )
        .onAppear {
            loadItems()
            startPulseAnimation()
            startActiveSlotRotation()
        }
        .onChange(of: items) { _, _ in
            saveItems()
        }
    }
    
    private func handleDrop(_ item: ShelfItem, at index: Int) {
        // Remove item from current position if it exists
        if let existingIndex = items.firstIndex(where: { $0?.id == item.id }) {
            items[existingIndex] = nil
        }
        
        // Place item in new slot
        items[index] = item
        draggedItem = nil
    }
    
    private func removeItem(at index: Int) {
        items[index] = nil
    }
    
    private func startPulseAnimation() {
        Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { _ in
            pulsePhase = sin(Date().timeIntervalSince1970 * Double.pi)
        }
    }
    
    private func startActiveSlotRotation() {
        Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { _ in
            activeSlot = (activeSlot + 1) % maxSlots
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
            // Silent failure for this iteration
        }
    }
    
    private func loadItems() {
        guard let url = storageURL,
              FileManager.default.fileExists(atPath: url.path) else { return }
        
        do {
            let data = try Data(contentsOf: url)
            let loadedItems = try JSONDecoder().decode([ShelfItem].self, from: data)
            
            // Restore items to their original positions or first available slots
            for item in loadedItems.prefix(maxSlots) {
                if let index = items.firstIndex(where: { $0 == nil }) {
                    items[index] = item
                }
            }
        } catch {
            // Silent failure for this iteration
        }
    }
}