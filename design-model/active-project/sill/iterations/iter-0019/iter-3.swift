struct ShelfItem: Identifiable {
    let id = UUID()
    let name: String
    var position: CGPoint
    let color: Color
}

struct ContentView: View {
    @State private var items: [ShelfItem] = []
    @State private var newItemText: String = ""
    @State private var showingAddField: Bool = false
    @State private var draggedItem: UUID? = nil
    
    private let gridSize: CGFloat = 20
    private let shelfBounds = CGRect(x: 50, y: 150, width: 700, height: 450)
    
    var body: some View {
        ZStack {
            RadialGradient(
                colors: [Color(red: 0.4, green: 0.3, blue: 0.2), Color(red: 0.25, green: 0.18, blue: 0.12)],
                center: .center,
                startRadius: 100,
                endRadius: 500
            )
            .ignoresSafeArea()
            
            VStack(spacing: 0) {
                HStack {
                    ZStack {
                        if showingAddField {
                            HStack(spacing: 8) {
                                TextField("Add item...", text: $newItemText)
                                    .textFieldStyle(.plain)
                                    .font(.body)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 8)
                                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                                    .frame(width: 180)
                                    .onSubmit {
                                        addItem()
                                    }
                                
                                Button(action: cancelAdd) {
                                    Image(systemName: "xmark.circle.fill")
                                        .foregroundColor(.secondary)
                                }
                                .buttonStyle(.plain)
                            }
                            .transition(.asymmetric(
                                insertion: .scale(scale: 0.8).combined(with: .opacity),
                                removal: .scale(scale: 0.9).combined(with: .opacity)
                            ))
                        } else {
                            Button(action: {
                                withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                                    showingAddField = true
                                }
                            }) {
                                HStack(spacing: 6) {
                                    Image(systemName: "plus.circle.fill")
                                    Text("Add Item")
                                }
                                .font(.body.weight(.medium))
                                .foregroundColor(.orange)
                            }
                            .buttonStyle(.plain)
                            .transition(.asymmetric(
                                insertion: .scale(scale: 0.9).combined(with: .opacity),
                                removal: .scale(scale: 0.8).combined(with: .opacity)
                            ))
                        }
                    }
                    .frame(height: 32)
                    
                    Spacer()
                    
                    Text("\(items.count)/8")
                        .font(.body.monospacedDigit())
                        .foregroundColor(.orange.opacity(0.8))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(.black.opacity(0.3), in: Capsule())
                }
                .padding(.horizontal, 24)
                .padding(.top, 20)
                .padding(.bottom, 16)
                
                ZStack {
                    WoodenShelfView(bounds: shelfBounds)
                    
                    ForEach(items) { item in
                        ItemView(
                            item: item,
                            isDragged: draggedItem == item.id,
                            onMoved: { itemId, newPosition in
                                moveItem(id: itemId, to: snapToGrid(newPosition))
                            },
                            onDragChanged: { itemId, isDragging in
                                draggedItem = isDragging ? itemId : nil
                            }
                        )
                    }
                }
                
                Spacer()
            }
        }
        .onAppear {
            addSampleItems()
        }
    }
    
    private func snapToGrid(_ point: CGPoint) -> CGPoint {
        let snappedX = round(point.x / gridSize) * gridSize
        let snappedY = round(point.y / gridSize) * gridSize
        
        let constrainedX = max(shelfBounds.minX + 10, min(shelfBounds.maxX - 90, snappedX))
        let constrainedY = max(shelfBounds.minY + 20, min(shelfBounds.maxY - 120, snappedY))
        
        return CGPoint(x: constrainedX, y: constrainedY)
    }
    
    private func addItem() {
        guard !newItemText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              items.count < 8 else {
            cancelAdd()
            return
        }
        
        let gridColumns = Int((shelfBounds.width - 100) / 100)
        let gridRows = Int((shelfBounds.height - 140) / 120)
        
        var availablePositions: [CGPoint] = []
        for row in 0..<gridRows {
            for col in 0..<gridColumns {
                let x = shelfBounds.minX + 30 + CGFloat(col) * 100
                let y = shelfBounds.minY + 40 + CGFloat(row) * 120
                availablePositions.append(CGPoint(x: x, y: y))
            }
        }
        
        let occupiedPositions = Set(items.map { snapToGrid($0.position) })
        let freePositions = availablePositions.filter { !occupiedPositions.contains(snapToGrid($0)) }
        
        let position = freePositions.first ?? CGPoint(x: shelfBounds.midX, y: shelfBounds.midY)
        
        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
            let colors: [Color] = [.red, .blue, .green, .purple, .orange, .pink, .yellow]
            let newItem = ShelfItem(
                name: newItemText.trimmingCharacters(in: .whitespacesAndNewlines),
                position: position,
                color: colors.randomElement() ?? .blue
            )
            items.append(newItem)
            newItemText = ""
            showingAddField = false
        }
    }
    
    private func cancelAdd() {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
            newItemText = ""
            showingAddField = false
        }
    }
    
    private func moveItem(id: UUID, to position: CGPoint) {
        if let index = items.firstIndex(where: { $0.id == id }) {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                items[index].position = position
            }
        }
    }
    
    private func addSampleItems() {
        let sampleData = [
            ("Book", Color.blue),
            ("Plant", Color.green),
            ("Clock", Color.orange)
        ]
        
        for (index, (name, color)) in sampleData.enumerated() {
            let x = shelfBounds.minX + 30 + CGFloat(index % 6) * 100
            let y = shelfBounds.minY + 40 + CGFloat(index / 6) * 120
            items.append(ShelfItem(name: name, position: CGPoint(x: x, y: y), color: color))
        }
    }
}

struct WoodenShelfView: View {
    let bounds: CGRect
    
    var body: some View {
        ZStack {
            ForEach(0..<3) { shelf in
                let yOffset = bounds.minY + CGFloat(shelf) * 150 + 120
                
                ZStack {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.5, green: 0.35, blue: 0.25),
                                    Color(red: 0.4, green: 0.28, blue: 0.2)
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .frame(width: bounds.width, height: 20)
                        .position(x: bounds.midX, y: yOffset)
                        .shadow(color: .black.opacity(0.3), radius: 4, x: 0, y: 2)
                    
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color(red: 0.3, green: 0.2, blue: 0.15).opacity(0.5))
                        .frame(width: bounds.width - 10, height: 3)
                        .position(x: bounds.midX, y: yOffset - 8)
                }
            }
        }
    }
}

struct ItemView: View {
    let item: ShelfItem
    let isDragged: Bool
    let onMoved: (UUID, CGPoint) -> Void
    let onDragChanged: (UUID, Bool) -> Void
    
    @State private var dragOffset: CGSize = .zero
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(item.color.gradient)
                .frame(width: 80, height: 100)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(.white.opacity(0.3), lineWidth: 1)
                )
                .shadow(color: .black.opacity(isDragged ? 0.4 : 0.2), radius: isDragged ? 8 : 4)
                .scaleEffect(isDragged ? 1.1 : 1.0)
            
            VStack(spacing: 8) {
                Image(systemName: iconForItem(item.name))
                    .font(.system(size: 28))
                    .foregroundColor(.white)
                
                Text(item.name)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.white)
                    .lineLimit(1)
            }
            .padding(8)
        }
        .position(item.position)
        .offset(dragOffset)
        .gesture(
            DragGesture()
                .onChanged { value in
                    if !isDragged {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                            onDragChanged(item.id, true)
                        }
                    }
                    dragOffset = value.translation
                }
                .onEnded { value in
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                        dragOffset = .zero
                        onDragChanged(item.id, false)
                    }
                    let newPosition = CGPoint(
                        x: item.position.x + value.translation.width,
                        y: item.position.y + value.translation.height
                    )
                    onMoved(item.id, newPosition)
                }
        )
    }
    
    private func iconForItem(_ name: String) -> String {
        switch name.lowercased() {
        case "book": return "book.fill"
        case "plant": return "leaf.fill"
        case "clock": return "clock.fill"
        default: return "cube.fill"
        }
    }
}