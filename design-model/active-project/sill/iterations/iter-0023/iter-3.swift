struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(name: "Project Alpha", createdAt: Date().addingTimeInterval(-2 * 24 * 3600), imageName: "folder.fill"),
        ShelfItem(name: "Design Brief", createdAt: Date().addingTimeInterval(-5 * 24 * 3600), imageName: "doc.text.fill"),
        ShelfItem(name: "Assets", createdAt: Date().addingTimeInterval(-1 * 24 * 3600), imageName: "photo.stack.fill")
    ]
    
    @State private var draggedItem: ShelfItem? = nil
    @State private var targetSlot: Int? = nil
    
    var body: some View {
        VStack(spacing: 24) {
            Text("Digital Shelf")
                .font(.system(.largeTitle, design: .default, weight: .semibold))
                .foregroundColor(.primary)
                .padding(.top, 40)
            
            Spacer()
            
            HStack(spacing: 12) {
                ForEach(0..<8, id: \.self) { index in
                    ShelfSlot(
                        index: index,
                        isHighlighted: targetSlot == index
                    )
                    .overlay(
                        Group {
                            if index < items.count && draggedItem?.id != items[index].id {
                                ItemCard(item: items[index])
                                    .onDrag {
                                        draggedItem = items[index]
                                        return NSItemProvider(object: items[index].name as NSString)
                                    }
                            }
                        }
                    )
                    .onDrop(of: [.text], delegate: SlotDropDelegate(
                        slotIndex: index,
                        items: $items,
                        draggedItem: $draggedItem,
                        targetSlot: $targetSlot
                    ))
                }
            }
            .padding(.horizontal, 32)
            
            Spacer()
        }
        .background(
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
                .ignoresSafeArea()
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let effectView = NSVisualEffectView()
        effectView.material = material
        effectView.blendingMode = blendingMode
        effectView.state = .active
        return effectView
    }
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}

struct ShelfSlot: View {
    let index: Int
    let isHighlighted: Bool
    
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(.quaternary)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(
                        isHighlighted ? Color.accentColor : Color.separator,
                        lineWidth: isHighlighted ? 2 : 0.5
                    )
            )
            .frame(width: 80, height: 100)
            .scaleEffect(isHighlighted ? 1.04 : 1.0)
            .animation(.easeInOut(duration: 0.2), value: isHighlighted)
    }
}

struct ItemCard: View {
    let item: ShelfItem
    
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: item.imageName)
                .font(.system(size: 24, weight: .medium))
                .foregroundColor(.accentColor)
                .frame(width: 28, height: 28)
            
            Text(item.name)
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.primary)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 64)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 6)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 6))
        .shadow(color: .black.opacity(0.1), radius: 2, x: 0, y: 1)
    }
}

struct SlotDropDelegate: DropDelegate {
    let slotIndex: Int
    @Binding var items: [ShelfItem]
    @Binding var draggedItem: ShelfItem?
    @Binding var targetSlot: Int?
    
    func dropEntered(info: DropInfo) {
        targetSlot = slotIndex
    }
    
    func dropExited(info: DropInfo) {
        if targetSlot == slotIndex {
            targetSlot = nil
        }
    }
    
    func performDrop(info: DropInfo) -> Bool {
        guard let draggedItem = draggedItem,
              let fromIndex = items.firstIndex(of: draggedItem) else {
            return false
        }
        
        withAnimation(.easeInOut(duration: 0.3)) {
            let toIndex = min(slotIndex, 7)
            
            if fromIndex != toIndex {
                items.remove(at: fromIndex)
                if toIndex < items.count {
                    items.insert(draggedItem, at: toIndex)
                } else {
                    items.append(draggedItem)
                }
            }
        }
        
        self.draggedItem = nil
        targetSlot = nil
        return true
    }
    
    func dropUpdated(info: DropInfo) -> DropProposal? {
        return DropProposal(operation: .move)
    }
}