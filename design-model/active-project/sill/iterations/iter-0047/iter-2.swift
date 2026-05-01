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
            VStack(spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Decay Garden")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.primary)
                    
                    Text("\(items.count) fading memories")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal)
                
                DecayVisualization(items: items)
                    .padding(.horizontal)
                
                Spacer()
                
                Button {
                    withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                        let newItem = DecayableItem(
                            text: "New memory",
                            position: CGPoint(
                                x: Double.random(in: 200...800),
                                y: Double.random(in: 200...600)
                            )
                        )
                        items.append(newItem)
                    }
                } label: {
                    HStack {
                        Image(systemName: "plus.circle.fill")
                        Text("Plant Memory")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.regular)
                .padding()
            }
            .frame(minWidth: 220)
            .background(
                LinearGradient(
                    colors: [Color.black.opacity(0.02), Color.clear],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        } detail: {
            ZStack {
                RadialGradient(
                    colors: [Color.clear, Color.black.opacity(0.03)],
                    center: .center,
                    startRadius: 100,
                    endRadius: 600
                )
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
                                withAnimation(.easeOut(duration: 0.8)) {
                                    items.removeAll { $0.id == item.id }
                                }
                            }
                        }
                    )
                }
            }
            .navigationTitle("Memory Canvas")
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear {
            timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { _ in
                items.removeAll { $0.decayProgress >= 1.0 }
            }
        }
        .onDisappear {
            timer?.invalidate()
        }
    }
    
    private func daysSinceCreated(_ date: Date) -> String {
        let days = Int(Date().timeIntervalSince(date) / 86400)
        return "\(days)d ago"
    }
}