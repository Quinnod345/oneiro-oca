struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(title: "Morning Coffee", addedDate: Calendar.current.date(byAdding: .hour, value: -8, to: Date()) ?? Date(), color: .accentColor),
        ShelfItem(title: "Garden Notes", addedDate: Calendar.current.date(byAdding: .day, value: -2, to: Date()) ?? Date(), color: .green),
        ShelfItem(title: "Recipe Collection", addedDate: Calendar.current.date(byAdding: .day, value: -4, to: Date()) ?? Date(), color: .orange),
        ShelfItem(title: "Travel Memories", addedDate: Calendar.current.date(byAdding: .day, value: -6, to: Date()) ?? Date(), color: .purple),
        ShelfItem(title: "Old Letters", addedDate: Calendar.current.date(byAdding: .day, value: -8, to: Date()) ?? Date(), color: .brown),
        ShelfItem(title: "Poetry Draft", addedDate: Calendar.current.date(byAdding: .day, value: -10, to: Date()) ?? Date(), color: .indigo)
    ]
    
    @State private var hoveredItem: UUID?
    
    var body: some View {
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.adaptive(minimum: 200), spacing: 16), count: 3), spacing: 16) {
                ForEach(items) { item in
                    VStack(alignment: .leading, spacing: 12) {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(item.color.gradient)
                            .frame(height: 160)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(.quaternary, lineWidth: 0.5)
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
}