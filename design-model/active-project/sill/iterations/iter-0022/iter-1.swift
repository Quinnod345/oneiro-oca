struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(name: "Notes", type: .note, dateAdded: Calendar.current.date(byAdding: .day, value: -1, to: Date()) ?? Date()),
        ShelfItem(name: "Image", type: .image, dateAdded: Calendar.current.date(byAdding: .day, value: -2, to: Date()) ?? Date()),
        ShelfItem(name: "Link", type: .link, dateAdded: Calendar.current.date(byAdding: .day, value: -3, to: Date()) ?? Date()),
        ShelfItem(name: "Document", type: .document, dateAdded: Calendar.current.date(byAdding: .day, value: -5, to: Date()) ?? Date()),
        ShelfItem(name: "File", type: .file, dateAdded: Calendar.current.date(byAdding: .day, value: -6, to: Date()) ?? Date())
    ]
    
    @State private var hoveredItem: UUID? = nil
    
    var body: some View {
        VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
            .frame(width: 680, height: 180)
            .overlay(
                HStack(spacing: 16) {
                    ForEach(0..<8, id: \.self) { index in
                        if index < items.count {
                            ShelfSlotView(
                                item: items[index],
                                isHovered: hoveredItem == items[index].id
                            )
                            .onHover { isHovered in
                                withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                                    hoveredItem = isHovered ? items[index].id : nil
                                }
                            }
                        } else {
                            EmptyShelfSlotView()
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
    let isHovered: Bool
    
    var opacity: Double {
        let ageFactor = max(0.6, 1.0 - (item.ageInDays / 7.0) * 0.4)
        return isHovered ? 1.0 : ageFactor
    }
    
    var body: some View {
        VStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 8)
                .fill(VisualEffectView(material: .contentBackground, blendingMode: .behindWindow))
                .frame(width: 64, height: 64)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.accentColor.opacity(isHovered ? 0.8 : 0.0), lineWidth: 2)
                )
                .overlay(
                    Image(systemName: item.type.rawValue)
                        .font(.system(size: 24, weight: .medium))
                        .foregroundStyle(Color.accentColor)
                        .opacity(opacity)
                )
                .scaleEffect(isHovered ? 1.05 : 1.0)
                .shadow(color: .black.opacity(isHovered ? 0.1 : 0.05), radius: isHovered ? 8 : 4, x: 0, y: 2)
            
            Text(item.name)
                .font(.system(size: 13, weight: .regular, design: .default))
                .foregroundStyle(.secondary)
                .opacity(opacity)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .frame(width: 64)
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: isHovered)
    }
}

struct EmptyShelfSlotView: View {
    var body: some View {
        VStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 8)
                .fill(VisualEffectView(material: .contentBackground, blendingMode: .behindWindow))
                .frame(width: 64, height: 64)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.tertiary, lineWidth: 1)
                        .opacity(0.3)
                )
                .overlay(
                    Circle()
                        .fill(Color.quaternary)
                        .frame(width: 6, height: 6)
                )
            
            Text("")
                .font(.system(size: 13, weight: .regular))
                .frame(height: 18)
        }
        .frame(width: 64)
    }
}

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = blendingMode
        return view
    }
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}