struct ContentView: View {
    @StateObject private var shelf = ClipboardShelf()
    @State private var headerHovered = false
    
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 16) {
                HStack(spacing: 12) {
                    Image(systemName: "tray.full")
                        .font(.title2)
                        .foregroundColor(.accentColor)
                        .scaleEffect(headerHovered ? 1.1 : 1.0)
                        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: headerHovered)
                    
                    Text("Clipboard Shelf")
                        .font(.title2)
                        .fontWeight(.semibold)
                        .foregroundColor(.primary)
                }
                .onHover { hovering in
                    headerHovered = hovering
                }
                
                Spacer()
                
                HStack(spacing: 12) {
                    Text("\(shelf.items.count)/8")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.quaternary, in: Capsule())
                    
                    Button(action: {}) {
                        Image(systemName: "gear")
                            .font(.body)
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(PlainButtonStyle())
                    .onHover { hovering in
                        // Add hover state if needed
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 20)
            
            Divider()
                .opacity(0.6)
            
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 16) {
                    ForEach(0..<8, id: \.self) { index in
                        let item: ClipItem? = index < shelf.items.count ? shelf.items[index] : nil
                        let itemOpacity: Double = item != nil ? shelf.opacity(for: item!) : 1.0
                        let dynamicSpacing: CGFloat = item != nil ? 16 : 12
                        
                        ClipSlot(
                            item: item,
                            slotIndex: index,
                            opacity: itemOpacity,
                            onDrop: { newItem in
                                withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                                    shelf.addItem(newItem)
                                }
                            },
                            onDrag: { draggedItem in
                                shelf.removeItem(draggedItem)
                            }
                        )
                        .frame(width: 120)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
            }
        }
        .background(.thickMaterial, in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(.quaternary, lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.12), radius: 12, x: 0, y: 6)
        .shadow(color: .black.opacity(0.08), radius: 4, x: 0, y: 2)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.6).delay(0.2)) {
                shelf.addItem(ClipItem(content: "Welcome to Clipboard Shelf"))
                shelf.addItem(ClipItem(content: "Drag and drop items here"))
                shelf.addItem(ClipItem(content: "https://example.com"))
            }
        }
    }
}