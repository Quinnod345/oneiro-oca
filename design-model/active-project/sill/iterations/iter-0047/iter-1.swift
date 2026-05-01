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
    @State private var showingSidebar = true
    
    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Decay Tasks", systemImage: "hourglass")
                        .font(.title2)
                        .fontWeight(.semibold)
                    
                    Text("\(items.count) active items")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal)
                
                Divider()
                
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(items) { item in
                            HStack {
                                Circle()
                                    .fill(.secondary)
                                    .frame(width: 6, height: 6)
                                
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.text)
                                        .font(.system(size: 12))
                                        .lineLimit(1)
                                    
                                    Text(daysSinceCreated(item.createdAt))
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                                
                                Spacer()
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 6))
                        }
                    }
                    .padding(.horizontal)
                }
                
                Spacer()
                
                Button {
                    withAnimation(.spring()) {
                        let newItem = DecayableItem(
                            text: "New task",
                            position: CGPoint(
                                x: Double.random(in: 200...800),
                                y: Double.random(in: 200...600)
                            )
                        )
                        items.append(newItem)
                    }
                } label: {
                    Label("Add Item", systemImage: "plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.regular)
                .padding()
            }
            .frame(minWidth: 220)
            .background(.sidebar)
        } detail: {
            ZStack {
                Rectangle()
                    .fill(.background)
                    .ignoresSafeArea()
                
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
                            
                            let screenBounds = CGRect(x: 0, y: 0, width: 1000, height: 700)
                            let itemBounds = CGRect(x: item.position.x - 100, y: item.position.y - 40, width: 200, height: 80)
                            
                            if !screenBounds.intersects(itemBounds) {
                                withAnimation(.easeOut(duration: 0.3)) {
                                    items.removeAll { $0.id == item.id }
                                }
                            }
                        }
                    )
                }
            }
            .navigationTitle("Workspace")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        withAnimation(.spring()) {
                            let newItem = DecayableItem(
                                text: "Quick task",
                                position: CGPoint(
                                    x: Double.random(in: 200...800),
                                    y: Double.random(in: 200...600)
                                )
                            )
                            items.append(newItem)
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                    .keyboardShortcut("n", modifiers: .command)
                }
            }
        }
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
    
    private func daysSinceCreated(_ date: Date) -> String {
        let days = Calendar.current.dateComponents([.day], from: date, to: Date()).day ?? 0
        return days == 0 ? "Today" : "\(days)d ago"
    }
}