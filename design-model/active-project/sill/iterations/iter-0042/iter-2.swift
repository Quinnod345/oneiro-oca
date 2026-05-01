struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(title: "Morning Coffee", addedDate: Calendar.current.date(byAdding: .hour, value: -8, to: Date()) ?? Date(), category: .food, icon: "cup.and.saucer.fill"),
        ShelfItem(title: "Garden Notes", addedDate: Calendar.current.date(byAdding: .day, value: -2, to: Date()) ?? Date(), category: .nature, icon: "leaf.fill"),
        ShelfItem(title: "Recipe Collection", addedDate: Calendar.current.date(byAdding: .day, value: -4, to: Date()) ?? Date(), category: .food, icon: "book.fill"),
        ShelfItem(title: "Travel Memories", addedDate: Calendar.current.date(byAdding: .day, value: -6, to: Date()) ?? Date(), category: .travel, icon: "airplane"),
        ShelfItem(title: "Old Letters", addedDate: Calendar.current.date(byAdding: .day, value: -8, to: Date()) ?? Date(), category: .personal, icon: "envelope.fill"),
        ShelfItem(title: "Poetry Draft", addedDate: Calendar.current.date(byAdding: .day, value: -10, to: Date()) ?? Date(), category: .creative, icon: "pencil.and.outline")
    ]
    
    @State private var hoveredItem: UUID?
    
    var body: some View {
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.adaptive(minimum: 200), spacing: 16), count: 3), spacing: 16) {
                ForEach(items) { item in
                    VStack(alignment: .leading, spacing: 12) {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(item.category.color)
                            .frame(height: 160)
                            .overlay(
                                VStack {
                                    Image(systemName: item.icon)
                                        .font(.system(size: 32, weight: .medium))
                                        .foregroundColor(item.category.accentColor)
                                        .opacity(0.8)
                                    
                                    if hoveredItem == item.id {
                                        Text("Added \(timeAgo(from: item.addedDate))")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                            .padding(.top, 8)
                                            .transition(.opacity.combined(with: .scale))
                                    }
                                }
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(item.category.accentColor.opacity(0.3), lineWidth: 1)
                            )
                        
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.title)
                                .font(.headline)
                                .foregroundStyle(.primary)
                                .lineLimit(2)
                            
                            Text(item.addedDate, style: .date)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(12)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                    .scaleEffect(hoveredItem == item.id ? 1.02 : 1.0)
                    .shadow(color: .black.opacity(hoveredItem == item.id ? 0.1 : 0.05), radius: hoveredItem == item.id ? 8 : 4, x: 0, y: 2)
                    .animation(.spring(response: 0.3, dampingFraction: 0.7), value: hoveredItem)
                    .onHover { isHovered in
                        hoveredItem = isHovered ? item.id : nil
                    }
                }
            }
            .padding(20)
        }
        .background(.thickMaterial)
        .navigationTitle("Collection")
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