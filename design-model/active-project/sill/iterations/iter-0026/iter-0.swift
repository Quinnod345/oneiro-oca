struct ContentView: View {
    @StateObject private var shelf: ClipboardShelf = ClipboardShelf()
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Image(systemName: "books.vertical")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(Color(red: 0.6, green: 0.4, blue: 0.2))
                
                Text("Clipboard Shelf")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundColor(Color(red: 0.4, green: 0.3, blue: 0.2))
                
                Spacer()
                
                Button(action: {}) {
                    Image(systemName: "gear")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(Color(red: 0.6, green: 0.4, blue: 0.2))
                }
                .buttonStyle(PlainButtonStyle())
                .opacity(0.7)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(Color(red: 0.95, green: 0.88, blue: 0.75))
            
            Divider()
                .background(Color(red: 0.8, green: 0.6, blue: 0.4).opacity(0.3))
            
            // Main shelf
            HStack(spacing: 8) {
                ForEach(0..<8, id: \.self) { index in
                    let item: ClipItem? = index < shelf.items.count ? shelf.items[index] : nil
                    let itemOpacity: Double = item != nil ? shelf.opacity(for: item!) : 1.0
                    
                    ClipSlot(
                        item: item,
                        opacity: itemOpacity,
                        onDrop: { newItem in
                            shelf.addItem(newItem)
                        },
                        onDrag: { draggedItem in
                            shelf.removeItem(draggedItem)
                        }
                    )
                }
            }
            .padding(16)
            .background(
                LinearGradient(
                    colors: [
                        Color(red: 0.98, green: 0.92, blue: 0.8),
                        Color(red: 0.95, green: 0.88, blue: 0.75)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
        .background(Color(red: 0.95, green: 0.88, blue: 0.75))
        .frame(width: 720, height: 120)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(color: Color.black.opacity(0.15), radius: 8, x: 0, y: 4)
    }
}