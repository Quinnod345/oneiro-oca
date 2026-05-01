struct ContentView: View {
    @StateObject private var shelf: ClipboardShelf = ClipboardShelf()
    
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "books.vertical")
                    .font(.headline)
                    .foregroundColor(.accentColor)
                
                Text("Clipboard Shelf")
                    .font(.headline)
                    .foregroundColor(.primary)
                
                Spacer()
                
                Button(action: {}) {
                    Image(systemName: "gear")
                        .font(.body)
                        .foregroundColor(.secondary)
                }
                .buttonStyle(PlainButtonStyle())
            }
            .padding()
            .background(.regularMaterial)
            
            Divider()
            
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
            .padding()
            .background(.regularMaterial)
        }
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(radius: 8)
    }
}