struct ContentView: View {
    @State private var items: [DecayableItem] = [
        DecayableItem(text: "Morning coffee ritual", createdAt: Calendar.current.date(byAdding: .day, value: -1, to: Date()) ?? Date(), position: CGPoint(x: 300, y: 200)),
        DecayableItem(text: "Call mom about weekend plans", createdAt: Calendar.current.date(byAdding: .day, value: -3, to: Date()) ?? Date(), position: CGPoint(x: 600, y: 300)),
        DecayableItem(text: "Finish reading chapter 7", createdAt: Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date(), position: CGPoint(x: 900, y: 250)),
        DecayableItem(text: "Water the plants", createdAt: Calendar.current.date(byAdding: .day, value: -5, to: Date()) ?? Date(), position: CGPoint(x: 450, y: 450)),
        DecayableItem(text: "Schedule dentist appointment", createdAt: Calendar.current.date(byAdding: .day, value: -8, to: Date()) ?? Date(), position: CGPoint(x: 200, y: 350))
    ]
    
    @State private var draggedItem: DecayableItem?
    @State private var timer: Timer?
    
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.98, green: 0.96, blue: 0.93),
                    Color(red: 0.95, green: 0.92, blue: 0.87),
                    Color(red: 0.92, green: 0.88, blue: 0.81)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            
            Canvas { context, size in
                let woodGrainLines = 20
                for i in 0..<woodGrainLines {
                    let y = Double(i) * Double(size.height) / Double(woodGrainLines)
                    let amplitude = Double.random(in: 2...8)
                    let frequency = Double.random(in: 0.002...0.005)
                    
                    var path = Path()
                    path.move(to: CGPoint(x: 0, y: y))
                    
                    for x in stride(from: 0, through: Double(size.width), by: 2) {
                        let wave = sin(x * frequency) * amplitude
                        path.addLine(to: CGPoint(x: x, y: y + wave))
                    }
                    
                    context.stroke(
                        path,
                        with: .color(Color(red: 0.85, green: 0.78, blue: 0.68).opacity(0.15)),
                        lineWidth: 1
                    )
                }
            }
            .allowsHitTesting(false)
            
            ForEach(items.indices, id: \.self) { index in
                ItemCard(
                    item: items[index],
                    onDrag: { item, newPosition in
                        if let itemIndex = items.firstIndex(where: { $0.id == item.id }) {
                            items[itemIndex].position = newPosition
                        }
                    },
                    onDragEnd: { item in
                        if let itemIndex = items.firstIndex(where: { $0.id == item.id }) {
                            items[itemIndex].lastInteraction = Date()
                        }
                        
                        let screenBounds = CGRect(x: 0, y: 0, width: 1440, height: 900)
                        let itemBounds = CGRect(x: item.position.x - 100, y: item.position.y - 40, width: 200, height: 80)
                        
                        if !screenBounds.intersects(itemBounds) {
                            items.removeAll { $0.id == item.id }
                        }
                    }
                )
            }
            
            VStack {
                Spacer()
                HStack {
                    Button("Add Item") {
                        let newItem = DecayableItem(
                            text: "New task",
                            position: CGPoint(
                                x: Double.random(in: 200...1200),
                                y: Double.random(in: 200...600)
                            )
                        )
                        items.append(newItem)
                    }
                    .font(.system(size: 14, weight: .medium, design: .serif))
                    .foregroundColor(Color(red: 0.3, green: 0.25, blue: 0.2))
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color(red: 0.94, green: 0.91, blue: 0.86))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color(red: 0.8, green: 0.75, blue: 0.68), lineWidth: 0.5)
                            )
                    )
                    
                    Spacer()
                }
                .padding(.leading, 40)
                .padding(.bottom, 40)
            }
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { _ in
                items = items.map { item in
                    var updatedItem = item
                    return updatedItem
                }
            }
        }
        .onDisappear {
            timer?.invalidate()
        }
    }
}