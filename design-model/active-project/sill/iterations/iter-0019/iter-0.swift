struct ContentView: View {
    @State private var items: [ShelfItem] = []
    @State private var newItemText: String = ""
    @State private var showingAddField: Bool = false
    
    var body: some View {
        ZStack {
            WoodGrainCanvas()
                .ignoresSafeArea()
            
            VStack {
                HStack {
                    if showingAddField {
                        TextField("Add item...", text: $newItemText)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12, weight: .regular, design: .default))
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
                        .font(.system(size: 12, weight: .medium, design: .default))
                    }
                    
                    Spacer()
                    
                    Text("\(items.count)/8")
                        .font(.system(size: 11, weight: .regular, design: .monospaced))
                        .foregroundColor(Color(red: 0.8, green: 0.7, blue: 0.6))
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
        .frame(width: 1440, height: 900)
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
        
        let randomX = Double.random(in: 100...1340)
        let randomY = Double.random(in: 200...800)
        
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
            let x = 200.0 + Double(index * 250)
            let y = 400.0 + Double.random(in: -50...50)
            
            let item = ShelfItem(
                title: title,
                addedAt: date,
                position: CGPoint(x: x, y: y)
            )
            items.append(item)
        }
    }
}