struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(title: "Morning Coffee", addedDate: Calendar.current.date(byAdding: .hour, value: -8, to: Date()) ?? Date(), icon: "cup.and.saucer.fill"),
        ShelfItem(title: "Garden Notes", addedDate: Calendar.current.date(byAdding: .day, value: -2, to: Date()) ?? Date(), icon: "leaf.fill"),
        ShelfItem(title: "Recipe Collection", addedDate: Calendar.current.date(byAdding: .day, value: -4, to: Date()) ?? Date(), icon: "book.fill"),
        ShelfItem(title: "Travel Memories", addedDate: Calendar.current.date(byAdding: .day, value: -6, to: Date()) ?? Date(), icon: "airplane"),
        ShelfItem(title: "Old Letters", addedDate: Calendar.current.date(byAdding: .day, value: -8, to: Date()) ?? Date(), icon: "envelope.fill"),
        ShelfItem(title: "Poetry Draft", addedDate: Calendar.current.date(byAdding: .day, value: -10, to: Date()) ?? Date(), icon: "pencil.and.outline")
    ]
    
    @State private var hoveredItem: UUID?
    
    var sortedItems: [ShelfItem] {
        items.sorted { $0.addedDate > $1.addedDate }
    }
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(sortedItems) { item in
                    HStack(spacing: 16) {
                        Circle()
                            .fill(.accent.opacity(cardOpacity(for: item)))
                            .frame(width: 8, height: 8)
                        
                        RoundedRectangle(cornerRadius: 12)
                            .fill(.accent.opacity(cardOpacity(for: item)))
                            .frame(height: cardHeight(for: item))
                            .overlay(
                                HStack {
                                    VStack(alignment: .leading, spacing: 8) {
                                        HStack {
                                            Image(systemName: item.icon)
                                                .font(.title2)
                                                .foregroundStyle(.primary)
                                            
                                            Spacer()
                                            
                                            Text(timeAgo(from: item.addedDate))
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                        
                                        Text(item.title)
                                            .font(.headline)
                                            .foregroundStyle(.primary)
                                            .multilineTextAlignment(.leading)
                                    }
                                    .padding(16)
                                    
                                    Spacer()
                                }
                            )
                            .scaleEffect(hoveredItem == item.id ? 1.02 : 1.0)
                            .shadow(color: .black.opacity(hoveredItem == item.id ? 0.15 : 0.05), radius: hoveredItem == item.id ? 12 : 6, x: 0, y: 3)
                            .animation(.spring(response: 0.4, dampingFraction: 0.8), value: hoveredItem)
                            .onHover { isHovered in
                                hoveredItem = isHovered ? item.id : nil
                            }
                    }
                    .padding(.bottom, 24)
                }
            }
            .padding(.horizontal, 32)
            .padding(.vertical, 20)
        }
        .background(.ultraThinMaterial)
        .navigationTitle("Timeline")
    }
    
    private func cardHeight(for item: ShelfItem) -> CGFloat {
        let baseHeight: CGFloat = 80
        let daysOld = Calendar.current.dateComponents([.day], from: item.addedDate, to: Date()).day ?? 0
        return baseHeight + CGFloat(min(daysOld * 8, 60))
    }
    
    private func cardOpacity(for item: ShelfItem) -> Double {
        let daysOld = Calendar.current.dateComponents([.day], from: item.addedDate, to: Date()).day ?? 0
        return max(0.15, 0.8 - Double(daysOld) * 0.08)
    }
    
    private func timeAgo(from date: Date) -> String {
        let interval = Date().timeIntervalSince(date)
        if interval < 3600 {
            return "\(Int(interval / 60))m ago"
        } else if interval < 86400 {
            return "\(Int(interval / 3600))h ago"
        } else {
            return "\(Int(interval / 86400))d ago"
        }
    }
}