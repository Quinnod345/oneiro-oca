struct ContentView: View {
    @State private var items: [TimeDecayItem] = []
    @State private var clearingItems: Set<UUID> = []
    
    var body: some View {
        ZStack {
            Rectangle()
                .fill(.ultraThinMaterial)
                .ignoresSafeArea()
            
            VStack(spacing: 0) {
                HStack {
                    Text("Memory Shelf")
                        .font(.system(size: 19, weight: .semibold))
                        .foregroundStyle(.primary)
                    
                    Spacer()
                    
                    Text("\(items.count)/8")
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
                }
                .padding(.horizontal, 24)
                .padding(.top, 24)
                
                ZStack {
                    Rectangle()
                        .fill(.regularMaterial)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                    
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 20), count: 4), spacing: 20) {
                        ForEach(items) { item in
                            itemView(for: item)
                        }
                        
                        ForEach(0..<(8 - items.count), id: \.self) { _ in
                            emptySlot
                        }
                    }
                    .padding(24)
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 24)
                
                Spacer()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            setupSampleData()
        }
        .gesture(
            DragGesture(minimumDistance: 100)
                .onEnded { gesture in
                    if gesture.translation.x < -200 && abs(gesture.translation.y) < 50 {
                        clearAgedItems()
                    }
                }
        )
    }
    
    private func itemView(for item: TimeDecayItem) -> some View {
        ZStack {
            Rectangle()
                .fill(.thinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            
            VStack(spacing: 8) {
                Text(item.content)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.primary)
                    .lineLimit(3)
                    .multilineTextAlignment(.center)
                
                HStack {
                    Circle()
                        .fill(.accent)
                        .frame(width: 6, height: 6)
                    
                    Text(formatAge(item.ageInDays))
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(12)
        }
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(.quaternary, lineWidth: 1)
        )
        .opacity(clearingItems.contains(item.id) ? 0 : item.opacity)
        .scaleEffect(clearingItems.contains(item.id) ? 0.1 : item.scale)
        .animation(.interpolatingSpring(stiffness: 300, damping: 30), value: clearingItems.contains(item.id))
        .frame(height: 110)
    }
    
    private var emptySlot: some View {
        RoundedRectangle(cornerRadius: 12)
            .stroke(.quaternary, style: StrokeStyle(lineWidth: 1, dash: [6, 6]))
            .frame(height: 110)
            .overlay(
                Image(systemName: "plus.circle")
                    .font(.system(size: 18, weight: .light))
                    .foregroundStyle(.quaternary)
            )
    }
    
    private func formatAge(_ days: Double) -> String {
        if days < 1 {
            let hours = Int(days * 24)
            return "\(hours)h"
        } else {
            return "\(Int(days))d"
        }
    }
    
    private func setupSampleData() {
        let sampleItems = [
            ("Weekly review", -0.5),
            ("Call mom", -2.0),
            ("Grocery list", -4.0),
            ("Meeting notes", -7.0),
            ("Book ideas", -10.0)
        ]
        
        items = sampleItems.map { content, daysAgo in
            TimeDecayItem(
                content: content,
                createdAt: Date().addingTimeInterval(daysAgo * 24 * 3600)
            )
        }
    }
    
    private func clearAgedItems() {
        let itemsToRemove = items.filter { $0.ageInDays > 7 }
        
        for item in itemsToRemove {
            clearingItems.insert(item.id)
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            items.removeAll { itemsToRemove.contains($0) }
            clearingItems.removeAll()
        }
    }
}