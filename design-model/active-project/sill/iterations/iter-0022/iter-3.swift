struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(name: "Notes", type: .note, dateAdded: Calendar.current.date(byAdding: .day, value: -1, to: Date()) ?? Date()),
        ShelfItem(name: "Image", type: .image, dateAdded: Calendar.current.date(byAdding: .day, value: -2, to: Date()) ?? Date()),
        ShelfItem(name: "Link", type: .link, dateAdded: Calendar.current.date(byAdding: .day, value: -3, to: Date()) ?? Date()),
        ShelfItem(name: "Document", type: .document, dateAdded: Calendar.current.date(byAdding: .day, value: -5, to: Date()) ?? Date()),
        ShelfItem(name: "File", type: .file, dateAdded: Calendar.current.date(byAdding: .day, value: -6, to: Date()) ?? Date())
    ]
    
    @State private var hoveredItem: UUID? = nil
    @State private var isAddHovered: Bool = false
    
    var sortedItems: [ShelfItem] {
        items.sorted { $0.dateAdded > $1.dateAdded }
    }
    
    var dynamicWidth: CGFloat {
        let itemCount = min(items.count, 6)
        let itemWidth: CGFloat = 64
        let spacing: CGFloat = 16
        let padding: CGFloat = 48
        let addButtonWidth: CGFloat = 64
        
        return CGFloat(itemCount) * itemWidth + CGFloat(itemCount - 1) * spacing + addButtonWidth + spacing + padding
    }
    
    var body: some View {
        RoundedRectangle(cornerRadius: 12)
            .frame(width: dynamicWidth, height: 140)
            .background(
                VisualEffectView(material: .hudWindow, blendingMode: .behindWindow)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            )
            .overlay(
                HStack(spacing: 16) {
                    ForEach(Array(sortedItems.prefix(6).enumerated()), id: \.element.id) { index, item in
                        ShelfSlotView(
                            item: item,
                            index: index,
                            isHovered: hoveredItem == item.id
                        )
                        .onHover { isHovered in
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                                hoveredItem = isHovered ? item.id : nil
                            }
                        }
                    }
                    
                    AddButtonView(isHovered: isAddHovered)
                        .onHover { isHovered in
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                                isAddHovered = isHovered
                            }
                        }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 24)
            )
    }
}

struct ShelfSlotView: View {
    let item: ShelfItem
    let index: Int
    let isHovered: Bool
    
    var recencyOpacity: Double {
        return 1.0 - (Double(index) * 0.1)
    }
    
    var accentColor: Color {
        return .accentColor
    }
    
    var body: some View {
        VStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.white.opacity(0.1))
                .frame(width: 64, height: 64)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(accentColor.opacity(isHovered ? 0.6 : 0.0), lineWidth: 2)
                )
                .overlay(
                    Image(systemName: item.type.rawValue)
                        .font(.system(size: 24, weight: .medium))
                        .foregroundStyle(accentColor.opacity(recencyOpacity))
                )
                .scaleEffect(isHovered ? 1.1 : 1.0)
                .offset(y: isHovered ? -2 : 0)
                .shadow(color: accentColor.opacity(isHovered ? 0.2 : 0.05), radius: isHovered ? 8 : 4, x: 0, y: 2)
            
            Text(item.name)
                .font(.system(size: 11, weight: .medium, design: .default))
                .foregroundStyle(.primary.opacity(recencyOpacity))
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .frame(width: 64)
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: isHovered)
    }
}

struct AddButtonView: View {
    let isHovered: Bool
    
    var body: some View {
        VStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.white.opacity(0.1))
                .frame(width: 64, height: 64)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.accentColor.opacity(isHovered ? 0.6 : 0.2), lineWidth: isHovered ? 2 : 1)
                        .animation(.easeInOut(duration: 0.2), value: isHovered)
                )
                .overlay(
                    Image(systemName: "plus")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(Color.accentColor)
                )
                .scaleEffect(isHovered ? 1.05 : 1.0)
                .shadow(color: .black.opacity(isHovered ? 0.1 : 0.05), radius: isHovered ? 6 : 3, x: 0, y: 2)
            
            Text("Add")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
        }
        .frame(width: 64)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovered)
    }
}