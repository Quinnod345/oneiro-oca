struct ShelfItem: Identifiable {
    let id = UUID()
    let name: String
    let type: ItemType
    let dateAdded: Date
    
    enum ItemType: String, CaseIterable {
        case document = "doc.text"
        case image = "photo"
        case link = "link"
        case note = "note.text"
        case file = "paperclip"
    }
    
    var ageInDays: Double {
        Date().timeIntervalSince(dateAdded) / 86400
    }
    
    var opacity: Double {
        max(0.4, 1.0 - (ageInDays / 7.0) * 0.6)
    }
    
    var saturation: Double {
        max(0.3, 1.0 - (ageInDays / 7.0) * 0.7)
    }
}

struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(name: "Notes", type: .note, dateAdded: Calendar.current.date(byAdding: .day, value: -1, to: Date()) ?? Date()),
        ShelfItem(name: "Image", type: .image, dateAdded: Calendar.current.date(byAdding: .day, value: -2, to: Date()) ?? Date()),
        ShelfItem(name: "Link", type: .link, dateAdded: Calendar.current.date(byAdding: .day, value: -3, to: Date()) ?? Date()),
        ShelfItem(name: "Doc", type: .document, dateAdded: Calendar.current.date(byAdding: .day, value: -5, to: Date()) ?? Date()),
        ShelfItem(name: "File", type: .file, dateAdded: Calendar.current.date(byAdding: .day, value: -6, to: Date()) ?? Date())
    ]
    
    var body: some View {
        VStack(spacing: 0) {
            // Warm wooden windowsill background
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.17, green: 0.10, blue: 0.05),
                            Color(red: 0.29, green: 0.18, blue: 0.09)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(height: 180)
                .overlay(
                    HStack(spacing: 12) {
                        ForEach(0..<8, id: \.self) { index in
                            if index < items.count {
                                ShelfSlotView(item: items[index])
                            } else {
                                EmptyShelfSlotView()
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 24)
                )
        }
        .frame(width: 680, height: 180)
    }
}

struct ShelfSlotView: View {
    let item: ShelfItem
    
    var body: some View {
        VStack(spacing: 8) {
            // Item container with warm cream background
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(red: 0.96, green: 0.90, blue: 0.82))
                .frame(width: 64, height: 64)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(
                            Color(red: 0.85, green: 0.65, blue: 0.35),
                            lineWidth: 1.5
                        )
                )
                .overlay(
                    Image(systemName: item.type.rawValue)
                        .font(.system(size: 24, weight: .medium))
                        .foregroundColor(
                            Color(red: 0.65, green: 0.35, blue: 0.15)
                                .opacity(item.opacity)
                                .saturation(item.saturation)
                        )
                )
                .shadow(color: Color.black.opacity(0.15), radius: 2, x: 0, y: 1)
                .opacity(item.opacity)
            
            // Item label
            Text(item.name)
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundColor(
                    Color(red: 0.96, green: 0.90, blue: 0.82)
                        .opacity(item.opacity * 0.9)
                )
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .frame(width: 64)
    }
}

struct EmptyShelfSlotView: View {
    var body: some View {
        VStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(red: 0.35, green: 0.22, blue: 0.12))
                .frame(width: 64, height: 64)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(
                            Color(red: 0.45, green: 0.32, blue: 0.22),
                            lineWidth: 1
                        )
                        .opacity(0.6)
                )
                .overlay(
                    Circle()
                        .fill(Color(red: 0.55, green: 0.42, blue: 0.32))
                        .frame(width: 4, height: 4)
                        .opacity(0.4)
                )
            
            Text("")
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .frame(height: 13)
        }
        .frame(width: 64)
    }
}