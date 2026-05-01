struct ContentView: View {
    @State private var items: [ShelfItem] = []
    @State private var newItemText: String = ""
    @State private var showingAddField: Bool = false
    @State private var draggedItem: UUID? = nil
    
    private let gridSize: CGFloat = 20
    private let shelfBounds = CGRect(x: 50, y: 150, width: 700, height: 450)
    
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(.systemBackground), Color(.secondarySystemBackground)],
                startPoint: .top,
                endPoint: .bottom
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
                                    .onExitCommand {
                                        cancelAdd()
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
                                .foregroundColor(.blue)
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
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(.quaternary, in: Capsule())
                }
                .padding(.horizontal, 24)
                .padding(.top, 20)
                .padding(.bottom, 16)
                
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.quaternary.opacity(0.3))
                        .stroke(.separator.opacity(0.5), lineWidth: 1)
                        .frame(width: shelfBounds.width, height: shelfBounds.height)
                    
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
        
        let constrainedX = max(shelfBounds.minX, min(shelfBounds.maxX - 120, snappedX))
        let constrainedY = max(shelfBounds.minY, min(shelfBounds.maxY - 60, snappedY))
        
        return CGPoint(x: constrainedX, y: constrainedY)
    }
    
    private func addItem() {
        guard !newItemText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              items.count < 8 else {
            cancelAdd()
            return
        }
        
        let gridColumns = Int(shelfBounds.width / (120 + 20))
        let gridRows = Int(shelfBounds.height / (80 + 20))
        
        var availablePositions: [CGPoint] = []
        for row in 0..<gridRows {
            for col in 0..<gridColumns {
                let x = shelfBounds.minX + CGFloat(col) * (120 + 20)
                let y = shelfBounds.minY + CGFloat(row) * (80 + 20)
                availablePositions.append(CGPoint(x: x, y: y))
            }
        }
        
        let occupiedPositions = Set(items.map { snapToGrid($0.position) })
        let freePositions = availablePositions.filter { !occupiedPositions.contains($0) }
        
        let position = freePositions.randomElement() ?? CGPoint(x: shelfBounds.midX - 60, y: shelfBounds.midY - 30)
        
        let newItem = ShelfItem(
            title: newItemText.trimmingCharacters(in: .whitespacesAndNewlines),
            addedAt: Date(),
            position: position
        )
        
        withAnimation(.spring(response: 0.6, dampingFraction: 0.7)) {
            items.append(newItem)
        }
        
        cancelAdd()
    }
    
    private func cancelAdd() {
        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
            showingAddField = false
        }
        newItemText = ""
    }
    
    private func moveItem(id: UUID, to position: CGPoint) {
        if let index = items.firstIndex(where: { $0.id == id }) {
            items[index].position = position
        }
    }
    
    private func addSampleItems() {
        let sampleItems = [
            ("Meeting notes", Date().addingTimeInterval(-5 * 24 * 60 * 60)),
            ("Fresh idea", Date().addingTimeInterval(-10 * 60)),
            ("Old sketch", Date().addingTimeInterval(-8 * 24 * 60 * 60)),
            ("Recent draft", Date().addingTimeInterval(-2 * 60 * 60))
        ]
        
        for (index, (title, date)) in sampleItems.enumerated() {
            let col = index % 3
            let row = index / 3
            let x = shelfBounds.minX + CGFloat(col) * 140
            let y = shelfBounds.minY + CGFloat(row) * 100
            
            let item = ShelfItem(
                title: title,
                addedAt: date,
                position: CGPoint(x: x, y: y)
            )
            items.append(item)
        }
    }
}

struct ItemView: View {
    let item: ShelfItem
    let isDragged: Bool
    let onMoved: (UUID, CGPoint) -> Void
    let onDragChanged: (UUID, Bool) -> Void
    @State private var offset = CGSize.zero
    @State private var isDragging = false
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(item.title)
                .font(.system(size: 14, weight: .medium, design: .default))
                .foregroundColor(.primary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            
            Text(timeAgo(from: item.addedAt))
                .font(.system(size: 11, weight: .regular, design: .default))
                .foregroundColor(.secondary)
        }
        .frame(width: 100, height: 50, alignment: .topLeading)
        .padding(10)
        .background {
            RoundedRectangle(cornerRadius: 8)
                .fill(.regularMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(.separator.opacity(0.5), lineWidth: 0.5)
                }
        }
        .scaleEffect(isDragging ? 1.05 : 1.0)
        .shadow(
            color: .black.opacity(isDragging ? 0.15 : 0.05),
            radius: isDragging ? 8 : 2,
            x: 0,
            y: isDragging ? 4 : 1
        )
        .offset(x: item.position.x + offset.width, y: item.position.y + offset.height)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isDragging)
        .gesture(
            DragGesture()
                .onChanged { value in
                    if !isDragging {
                        isDragging = true
                        onDragChanged(item.id, true)
                    }
                    offset = value.translation
                }
                .onEnded { value in
                    let newPosition = CGPoint(
                        x: item.position.x + value.translation.x,
                        y: item.position.y + value.translation.y
                    )
                    
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                        onMoved(item.id, newPosition)
                        offset = .zero
                        isDragging = false
                        onDragChanged(item.id, false)
                    }
                }
        )
    }
    
    private func timeAgo(from date: Date) -> String {
        let now = Date()
        let timeInterval = now.timeIntervalSince(date)
        
        if timeInterval < 60 {
            return "Just now"
        } else if timeInterval < 3600 {
            let minutes = Int(timeInterval / 60)
            return "\(minutes)m ago"
        } else if timeInterval < 86400 {
            let hours = Int(timeInterval / 3600)
            return "\(hours)h ago"
        } else {
            let days = Int(timeInterval / 86400)
            return "\(days)d ago"
        }
    }
}