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
        let isVeryOld = ageInDays >= 14
        
        let degradationOpacity: Double = {
            if isVeryOld { return 0.3 }
            if isOld { return 0.6 }
            return 1.0
        }()
        
        return VStack(spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(item.type.accentColor.opacity(0.1))
                    .frame(height: 65)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(item.type.accentColor.opacity(isOld ? 0.3 : 0.6), lineWidth: 1)
                    )
                
                if isRecent {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(item.type.accentColor, lineWidth: 2)
                        .frame(height: 65)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(item.type.accentColor.opacity(0.1))
                                .frame(height: 65)
                                .scaleEffect(1.05)
                                .animation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true), value: isRecent)
                        )
                }
                
                VStack(spacing: 4) {
                    Image(systemName: item.type.iconName)
                        .font(.title3)
                        .fontWeight(.medium)
                        .foregroundColor(isOld ? item.type.accentColor.opacity(0.6) : item.type.accentColor)
                    
                    Text(item.type.displayName)
                        .font(.caption2)
                        .fontWeight(.medium)
                        .foregroundColor(.secondary)
                }
            }
            
            VStack(spacing: 2) {
                Text(item.title)
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundColor(isOld ? .secondary : .primary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                
                Text(formatDate(item.addedDate))
                    .font(.caption2)
                    .foregroundColor(.tertiary)
            }
        }
        .opacity(degradationOpacity)
        .scaleEffect(hoveredIndex == index ? 1.05 : 1.0)
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.2)) {
                hoveredIndex = hovering ? index : nil
            }
        }
        .contextMenu {
            contextMenuContent(for: item)
        }
        .onTapGesture(count: 2) {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                if let itemIndex = items.firstIndex(where: { $0.id == item.id }) {
                    items[itemIndex].priority = item.priority == .high ? .normal : .high
                }
            }
        }
    }
    
    private var emptySlotView: some View {
        VStack(spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(.clear)
                    .frame(height: 65)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(.quaternary, lineWidth: 1, lineCap: .round, dash: [4, 4])
                    )
                
                Image(systemName: "plus")
                    .font(.title3)
                    .foregroundColor(.quaternary)
            }
            
            VStack(spacing: 2) {
                Text("Empty")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundColor(.quaternary)
                
                Text("")
                    .font(.caption2)
            }
        }
        .onTapGesture {
            addSampleItem()
        }
    }
    
    @ViewBuilder
    private func contextMenuContent(for item: ShelfItem) -> some View {
        Button("Mark as Priority") {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                if let index = items.firstIndex(where: { $0.id == item.id }) {
                    items[index].priority = .high
                }
            }
        }
        
        Button("Remove Priority") {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                if let index = items.firstIndex(where: { $0.id == item.id }) {
                    items[index].priority = .normal
                }
            }
        }
        
        Divider()
        
        Button("Remove", role: .destructive) {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                items.removeAll { $0.id == item.id }
            }
        }
    }
    
    private func addSampleItem() {
        guard items.count < maxSlots else { return }
        
        let sampleItems = [
            ShelfItem(title: "New Document.pdf", type: .file, addedDate: Date()),
            ShelfItem(title: "github.com/example", type: .url, addedDate: Date()),
            ShelfItem(title: "Quick Note", type: .text, addedDate: Date()),
            ShelfItem(title: "contact@example.com", type: .email, addedDate: Date()),
            ShelfItem(title: "Screenshot.png", type: .image, addedDate: Date()),
            ShelfItem(title: "main.swift", type: .code, addedDate: Date())
        ]
        
        withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
            items.append(sampleItems.randomElement()!)
        }
    }
    
    private func clearOldItems() {
        withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
            let cutoffDate = Date().addingTimeInterval(-60 * 60 * 24 * 14) // 14 days
            items.removeAll { $0.addedDate < cutoffDate }
        }
    }
    
    private func formatDate(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
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
        guard let draggedItem = draggedItem else { return }
        
        if draggedItem.id != item.id {
            let fromIndex = items.firstIndex { $0.id == draggedItem.id } ?? 0
            let toIndex = items.firstIndex { $0.id == item.id } ?? 0
            
            withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                items.move(fromOffsets: IndexSet(integer: fromIndex), toOffset: toIndex > fromIndex ? toIndex + 1 : toIndex)
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
        guard let draggedItem = draggedItem else { return }
        
        let fromIndex = items.firstIndex { $0.id == draggedItem.id } ?? 0
        
        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
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