struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(title: "Project Proposal.pdf", type: .file, addedDate: Date().addingTimeInterval(-60 * 60 * 2), priority: .high),
        ShelfItem(title: "design-inspiration.com", type: .url, addedDate: Date().addingTimeInterval(-60 * 60 * 24 * 3)),
        ShelfItem(title: "Meeting notes draft", type: .text, addedDate: Date().addingTimeInterval(-60 * 60 * 24 * 8)),
        ShelfItem(title: "client@studio.com", type: .email, addedDate: Date().addingTimeInterval(-60 * 60 * 24 * 12)),
        ShelfItem(title: "App Icon.png", type: .image, addedDate: Date().addingTimeInterval(-60 * 60 * 6)),
        ShelfItem(title: "SwiftUI Component", type: .code, addedDate: Date().addingTimeInterval(-60 * 60 * 24 * 5))
    ]
    
    @State private var draggedItem: ShelfItem?
    @State private var hoveredIndex: Int?
    @State private var showingContextMenu = false
    
    private let maxSlots: Int = 12
    
    var adaptiveColumns: [GridItem] {
        let itemCount = min(items.count + 2, maxSlots)
        let columnCount = itemCount <= 4 ? itemCount : (itemCount <= 8 ? 4 : 6)
        return Array(repeating: GridItem(.flexible(), spacing: 12), count: max(columnCount, 3))
    }
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                VisualEffectView(material: .windowBackground, blendingMode: .behindWindow)
                    .ignoresSafeArea()
                
                VStack(spacing: 0) {
                    headerView
                    shelfPanel
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(.horizontal, 32)
                        .padding(.bottom, 32)
                }
            }
        }
        .frame(width: 1440, height: 900)
    }
    
    private var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Workbench")
                    .font(.largeTitle)
                    .fontWeight(.medium)
                    .foregroundColor(.primary)
                
                Text("\(items.count) of \(maxSlots) items")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            Spacer()
            
            HStack(spacing: 12) {
                Button(action: clearOldItems) {
                    Label("Clean", systemImage: "trash.slash")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.borderless)
                
                Button(action: addSampleItem) {
                    Image(systemName: "plus")
                        .font(.title2)
                        .foregroundColor(.accentColor)
                }
                .buttonStyle(.borderless)
                .controlSize(.large)
            }
        }
        .padding(.horizontal, 32)
        .padding(.top, 24)
        .padding(.bottom, 20)
    }
    
    private var shelfPanel: some View {
        ZStack {
            VisualEffectView(material: .contentBackground, blendingMode: .withinWindow)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .shadow(color: .black.opacity(0.1), radius: 8, x: 0, y: 4)
            
            ScrollView {
                LazyVGrid(columns: adaptiveColumns, spacing: 12) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        itemView(for: item, at: index)
                            .scaleEffect(item.priority.scale)
                            .onDrag {
                                draggedItem = item
                                return NSItemProvider(object: item.id.uuidString as NSString)
                            }
                            .onDrop(of: [.text], delegate: DropDelegate(
                                item: item,
                                items: $items,
                                draggedItem: $draggedItem
                            ))
                    }
                    
                    ForEach(items.count..<min(maxSlots, items.count + 3), id: \.self) { index in
                        emptySlotView
                            .onDrop(of: [.text], delegate: EmptyDropDelegate(
                                items: $items,
                                draggedItem: $draggedItem
                            ))
                    }
                }
                .padding(24)
                .animation(.spring(response: 0.6, dampingFraction: 0.8), value: items)
            }
        }
    }
    
    private func itemView(for item: ShelfItem, at index: Int) -> some View {
        let ageInDays = Calendar.current.dateComponents([.day], from: item.addedDate, to: Date()).day ?? 0
        let ageInHours = Calendar.current.dateComponents([.hour], from: item.addedDate, to: Date()).hour ?? 0
        
        let isRecent = ageInHours <= 24
        let isOld = ageInDays >= 7
        
        return VStack(spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.secondary.opacity(0.1))
                    .frame(height: 65)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.secondary.opacity(0.3), lineWidth: 1)
                    )
                
                if isRecent {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.accentColor.opacity(0.08))
                        .frame(height: 65)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.accentColor.opacity(0.5), lineWidth: 1)
                        )
                }
                
                Image(systemName: item.type.icon)
                    .font(.title2)
                    .foregroundColor(.secondary)
            }
            .onHover { isHovering in
                hoveredIndex = isHovering ? index : nil
            }
            .contextMenu {
                contextMenuContent(for: item)
            }
            
            Text(item.title)
                .font(.caption)
                .lineLimit(2)
                .foregroundColor(isOld ? .tertiary : .secondary)
                .frame(height: 32)
                .multilineTextAlignment(.center)
        }
        .opacity(isOld ? 0.6 : 1.0)
    }
    
    private var emptySlotView: some View {
        VStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.secondary.opacity(0.2), style: StrokeStyle(lineWidth: 1, dash: [5, 5]))
                .frame(height: 65)
                .foregroundColor(.clear)
            
            Rectangle()
                .fill(.clear)
                .frame(height: 32)
        }
    }
    
    private func contextMenuContent(for item: ShelfItem) -> some View {
        Group {
            Button("Open", action: {})
            Button("Share", action: {})
            Divider()
            Button("Remove") {
                removeItem(item)
            }
        }
    }
    
    private func removeItem(_ item: ShelfItem) {
        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
            items.removeAll { $0.id == item.id }
        }
    }
    
    private func clearOldItems() {
        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
            let calendar = Calendar.current
            items.removeAll { item in
                let ageInDays = calendar.dateComponents([.day], from: item.addedDate, to: Date()).day ?? 0
                return ageInDays >= 7
            }
        }
    }
    
    private func addSampleItem() {
        guard items.count < maxSlots else { return }
        
        let sampleItems = [
            ShelfItem(title: "New Document.pdf", type: .file, addedDate: Date()),
            ShelfItem(title: "example.com", type: .url, addedDate: Date()),
            ShelfItem(title: "Quick Note", type: .text, addedDate: Date()),
            ShelfItem(title: "contact@mail.com", type: .email, addedDate: Date()),
            ShelfItem(title: "Screenshot.png", type: .image, addedDate: Date()),
            ShelfItem(title: "Code Snippet", type: .code, addedDate: Date())
        ]
        
        let newItem = sampleItems.randomElement()!
        
        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
            items.insert(newItem, at: 0)
        }
    }
}

struct ShelfItem: Identifiable, Equatable {
    let id = UUID()
    let title: String
    let type: ItemType
    let addedDate: Date
    var priority: Priority = .normal
    
    enum ItemType: CaseIterable {
        case file, url, text, email, image, code
        
        var icon: String {
            switch self {
            case .file: return "doc.fill"
            case .url: return "link"
            case .text: return "text.alignleft"
            case .email: return "envelope.fill"
            case .image: return "photo.fill"
            case .code: return "curlybraces"
            }
        }
    }
    
    enum Priority {
        case normal, high
        
        var scale: Double {
            switch self {
            case .normal: return 1.0
            case .high: return 1.1
            }
        }
    }
}

struct DropDelegate: DropDelegate {
    let item: ShelfItem
    @Binding var items: [ShelfItem]
    @Binding var draggedItem: ShelfItem?
    
    func performDrop(info: DropInfo) -> Bool {
        draggedItem = nil
        return true
    }
    
    func dropEntered(info: DropInfo) {
        guard let draggedItem = draggedItem,
              let fromIndex = items.firstIndex(of: draggedItem),
              let toIndex = items.firstIndex(of: item) else { return }
        
        if fromIndex != toIndex {
            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                items.move(fromOffsets: IndexSet([fromIndex]), toOffset: toIndex > fromIndex ? toIndex + 1 : toIndex)
            }
        }
    }
}

struct EmptyDropDelegate: DropDelegate {
    @Binding var items: [ShelfItem]
    @Binding var draggedItem: ShelfItem?
    
    func performDrop(info: DropInfo) -> Bool {
        draggedItem = nil
        return true
    }
    
    func dropEntered(info: DropInfo) {
        guard let draggedItem = draggedItem,
              let fromIndex = items.firstIndex(of: draggedItem) else { return }
        
        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
            let item = items.remove(at: fromIndex)
            items.append(item)
        }
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
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}