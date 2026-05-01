struct ContentView: View {
    @StateObject private var shelf = ClipboardShelf()
    
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: "tray.full")
                    .font(.title2)
                    .foregroundColor(.accentColor)
                
                Text("Clipboard Shelf")
                    .font(.title2)
                    .fontWeight(.semibold)
                    .foregroundColor(.primary)
                
                Spacer()
                
                Button(action: {}) {
                    Image(systemName: "gear")
                        .font(.body)
                        .foregroundColor(.secondary)
                }
                .buttonStyle(PlainButtonStyle())
            }
            .padding(16)
            
            Divider()
            
            HStack(spacing: 12) {
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
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .shadow(color: .black.opacity(0.1), radius: 8, x: 0, y: 4)
        .onAppear {
            shelf.addItem(ClipItem(content: "Sample text"))
            shelf.addItem(ClipItem(content: "Another item"))
        }
    }
}