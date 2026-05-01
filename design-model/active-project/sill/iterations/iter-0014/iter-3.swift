struct ContentView: View {
    @State private var shelfItems: [ShelfItem] = [
        ShelfItem(name: "Notes", type: .document, preview: "Meeting notes from today's standup", daysOld: 2),
        ShelfItem(name: "Design", type: .image, preview: "Wireframes and mockups for v2.0", daysOld: 1),
        ShelfItem(name: "Code", type: .code, preview: "SwiftUI components library", daysOld: 0),
        ShelfItem(name: "Brief", type: .pdf, preview: "Project requirements document", daysOld: 5),
        ShelfItem(name: "Demo", type: .video, preview: "Screen recording of new flow", daysOld: 6),
        ShelfItem(isEmpty: true),
        ShelfItem(isEmpty: true),
        ShelfItem(isEmpty: true)
    ]
    
    @State private var selectedIndex: Int? = nil
    @State private var draggingIndex: Int? = nil
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
                .ignoresSafeArea()
            
            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Workspace Shelf")
                            .font(.system(size: 28, weight: .bold, design: .default))
                            .foregroundStyle(.primary)
                        
                        Text("Recent files and quick access")
                            .font(.system(size: 15, weight: .medium, design: .default))
                            .foregroundStyle(.secondary)
                    }
                    
                    Spacer()
                    
                    Button(action: {}) {
                        Image(systemName: "plus")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 32, height: 32)
                            .background(.quaternary, in: Circle())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 24)
                .padding(.top, 32)
                
                Spacer()
                
                VStack(spacing: 24) {
                    HStack(spacing: 16) {
                        ForEach(Array(shelfItems.enumerated()), id: \.element.id) { index, item in
                            ShelfSlot(
                                item: item,
                                slotIndex: index,
                                isSelected: selectedIndex == index,
                                onTap: { 
                                    withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                                        selectedIndex = selectedIndex == index ? nil : index
                                    }
                                }
                            )
                            .onDrag {
                                draggingIndex = index
                                return NSItemProvider(object: String(index) as NSString)
                            }
                            .onDrop(of: [.text], delegate: ShelfDropDelegate(
                                item: item,
                                shelfItems: $shelfItems,
                                draggedIndex: $draggingIndex,
                                dropIndex: index
                            ))
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 24)
                    .background {
                        RoundedRectangle(cornerRadius: 16)
                            .fill(.regularMaterial)
                            .stroke(Color(.separatorColor), lineWidth: 0.5)
                    }
                    .shadow(color: .black.opacity(0.05), radius: 10, x: 0, y: 5)
                    
                    if let selectedIndex = selectedIndex, !shelfItems[selectedIndex].isEmpty {
                        ItemDetailView(item: shelfItems[selectedIndex])
                            .transition(.asymmetric(
                                insertion: .scale(scale: 0.9).combined(with: .opacity),
                                removal: .scale(scale: 0.9).combined(with: .opacity)
                            ))
                    }
                }
                
                Spacer()
                    .frame(height: 24)
            }
        }
        .frame(width: 1440, height: 900)
    }
}

struct ShelfSlot: View {
    let item: ShelfItem
    let slotIndex: Int
    let isSelected: Bool
    let onTap: () -> Void
    
    @State private var isHovered = false
    @State private var dragOffset = CGSize.zero
    
    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(item.isEmpty ? Color(.quaternarySystemFill) : item.type.accentColor)
                        .stroke(item.isEmpty ? Color(.tertiarySystemFill) : Color(.systemBlue).opacity(0.2), lineWidth: 1)
                        .frame(width: 72, height: 72)
                    
                    if !item.isEmpty {
                        Image(systemName: item.type.iconName)
                            .font(.system(size: 24, weight: .medium))
                            .foregroundStyle(Color(.systemBlue))
                        
                        if item.daysOld == 0 {
                            Circle()
                                .fill(Color(.systemGreen))
                                .frame(width: 8, height: 8)
                                .offset(x: 26, y: -26)
                        }
                    } else {
                        Image(systemName: "plus")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(.tertiary)
                    }
                }
                .scaleEffect(isHovered ? 1.05 : 1.0)
                .scaleEffect(isSelected ? 1.08 : 1.0)
                
                if !item.isEmpty {
                    Text(item.name)
                        .font(.system(size: 12, weight: .medium, design: .default))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                } else {
                    Text("Empty")
                        .font(.system(size: 12, weight: .medium, design: .default))
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.2)) {
                isHovered = hovering
            }
        }
        .offset(dragOffset)
    }
}

struct ItemDetailView: View {
    let item: ShelfItem
    
    var body: some View {
        VStack(spacing: 16) {
            HStack {
                Image(systemName: item.type.iconName)
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(Color(.systemBlue))
                
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.name)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.primary)
                    
                    Text("\(item.daysOld == 0 ? "Today" : "\(item.daysOld) days ago")")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                
                Spacer()
                
                Button("Open") {}
                    .buttonStyle(.borderless)
                    .controlSize(.small)
            }
            
            Text(item.preview)
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .multilineTextAlignment(.leading)
        }
        .padding(16)
        .background {
            RoundedRectangle(cornerRadius: 12)
                .fill(.regularMaterial)
                .stroke(Color(.separatorColor), lineWidth: 0.5)
        }
        .frame(width: 360)
    }
}

struct ShelfDropDelegate: DropDelegate {
    let item: ShelfItem
    @Binding var shelfItems: [ShelfItem]
    @Binding var draggedIndex: Int?
    let dropIndex: Int
    
    func performDrop(info: DropInfo) -> Bool {
        guard let draggedIndex = draggedIndex else { return false }
        
        if draggedIndex != dropIndex {
            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                let draggedItem = shelfItems[draggedIndex]
                shelfItems.remove(at: draggedIndex)
                shelfItems.insert(draggedItem, at: dropIndex)
            }
        }
        
        self.draggedIndex = nil
        return true
    }
    
    func dropEntered(info: DropInfo) {
        guard let draggedIndex = draggedIndex,
              draggedIndex != dropIndex else { return }
        
        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
            let draggedItem = shelfItems[draggedIndex]
            shelfItems.remove(at: draggedIndex)
            shelfItems.insert(draggedItem, at: dropIndex)
        }
        
        self.draggedIndex = dropIndex
    }
}

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = blendingMode
        view.state = .active
        return view
    }
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}