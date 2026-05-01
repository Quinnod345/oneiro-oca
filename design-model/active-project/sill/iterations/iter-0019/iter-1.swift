struct ContentView: View {
    @State private var items: [ShelfItem] = []
    @State private var newItemText: String = ""
    @State private var showingAddField: Bool = false
    
    var body: some View {
        ZStack {
            Rectangle()
                .fill(.regularMaterial)
                .ignoresSafeArea()
            
            VStack {
                HStack {
                    if showingAddField {
                        TextField("Add item...", text: $newItemText)
                            .textFieldStyle(.roundedBorder)
                            .font(.body)
                            .controlSize(.regular)
                            .frame(width: 200)
                            .onSubmit {
                                addItem()
                            }
                            .onExitCommand {
                                showingAddField = false
                                newItemText = ""
                            }
                    } else {
                        Button("Add Item") {
                            showingAddField = true
                        }
                        .buttonStyle(.bordered)
                        .font(.headline)
                        .controlSize(.regular)
                    }
                    
                    Spacer()
                    
                    Text("\(items.count)/8")
                        .font(.body)
                        .foregroundColor(.secondaryLabel)
                }
                .padding()
                
                Spacer()
            }
            
            ForEach(items) { item in
                ItemView(item: item) { itemId, newPosition in
                    moveItem(id: itemId, to: newPosition)
                }
            }
        }
        .onAppear {
            addSampleItems()
        }
    }
    
    private func addItem() {
        guard !newItemText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              items.count < 8 else {
            showingAddField = false
            newItemText = ""
            return
        }
        
        let randomX = Double.random(in: 100...600)
        let randomY = Double.random(in: 200...500)
        
        let newItem = ShelfItem(
            title: newItemText.trimmingCharacters(in: .whitespacesAndNewlines),
            addedAt: Date(),
            position: CGPoint(x: randomX, y: randomY)
        )
        
        withAnimation(.spring(response: 0.6, dampingFraction: 0.7, blendDuration: 0)) {
            items.append(newItem)
        }
        
        newItemText = ""
        showingAddField = false
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
            let x = 200.0 + Double(index * 150)
            let y = 300.0 + Double.random(in: -50...50)
            
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
    let onMoved: (UUID, CGPoint) -> Void
    @State private var offset = CGSize.zero
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(item.title)
                .font(.headline)
                .foregroundColor(.primary)
                .lineLimit(2)
            
            Text(timeAgo(from: item.addedAt))
                .font(.body)
                .foregroundColor(.secondaryLabel)
        }
        .padding(12)
        .background(.thickMaterial, in: RoundedRectangle(cornerRadius: 8))
        .shadow(color: .black.opacity(0.1), radius: 2, x: 0, y: 1)
        .offset(x: item.position.x + offset.width, y: item.position.y + offset.height)
        .gesture(
            DragGesture()
                .onChanged { value in
                    offset = value.translation
                }
                .onEnded { value in
                    let newPosition = CGPoint(
                        x: item.position.x + value.translation.x,
                        y: item.position.y + value.translation.y
                    )
                    onMoved(item.id, newPosition)
                    offset = .zero
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