struct ContentView: View {
    @State private var clipboardItems: [ClipboardItem] = []
    @State private var lastPasteboardChangeCount: Int = NSPasteboard.general.changeCount
    
    private let maxItems = 8
    private let checkInterval: TimeInterval = 1.0
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
                    .ignoresSafeArea()
                
                VStack(spacing: 24) {
                    headerView
                    itemGridView(for: geometry.size.width)
                    Spacer()
                }
                .padding(32)
            }
        }
        .frame(minWidth: 800, minHeight: 600)
        .onAppear {
            loadPersistedItems()
            startClipboardMonitoring()
        }
    }
    
    private var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                Text("Sill")
                    .font(.system(size: 28, weight: .medium, design: .default))
                    .foregroundColor(.primary)
                
                Text("Recent captures settle here briefly")
                    .font(.system(size: 13, weight: .regular))
                    .foregroundColor(.secondary)
            }
            Spacer()
            
            Text("\(clipboardItems.count)/\(maxItems)")
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundColor(.secondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(.thickMaterial)
                }
        }
    }
    
    private func itemGridView(for width: CGFloat) -> some View {
        let columnCount = max(2, min(4, Int((width - 64) / 180)))
        let columns = Array(repeating: GridItem(.flexible(), spacing: 20), count: columnCount)
        
        return LazyVGrid(columns: columns, spacing: 20) {
            ForEach(clipboardItems) { item in
                let daysSince = Calendar.current.dateComponents([.day], from: item.timestamp, to: Date()).day ?? 0
                
                ItemPreview(item: item, daysSinceCapture: daysSince)
                    .transition(.asymmetric(
                        insertion: .scale.combined(with: .opacity),
                        removal: .scale.combined(with: .opacity)
                    ))
                    .onDrag {
                        return NSItemProvider(object: item.content as NSString)
                    }
            }
            
            ForEach(clipboardItems.count..<maxItems, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(
                        Color.secondary.opacity(0.3),
                        style: StrokeStyle(lineWidth: 1, dash: [6, 4])
                    )
                    .background(.ultraThinMaterial.opacity(0.3))
                    .frame(height: 100)
                    .opacity(0.4)
            }
        }
    }
    
    private func startClipboardMonitoring() -> Void {
        Timer.scheduledTimer(withTimeInterval: checkInterval, repeats: true) { _ in
            checkClipboardChanges()
        }
    }
    
    private func checkClipboardChanges() -> Void {
        let currentChangeCount = NSPasteboard.general.changeCount
        
        if currentChangeCount != lastPasteboardChangeCount {
            lastPasteboardChangeCount = currentChangeCount
            processNewClipboardContent()
        }
        
        cleanupOldItems()
    }
    
    private func processNewClipboardContent() -> Void {
        let pasteboard = NSPasteboard.general
        
        if let string = pasteboard.string(forType: .string), !string.isEmpty {
            let itemType: ClipboardItem.ItemType
            let metadata: ClipboardItem.ItemMetadata?
            
            if string.hasPrefix("http://") || string.hasPrefix("https://") {
                itemType = .url
                let domain = URL(string: string)?.host ?? "Unknown"
                metadata = ClipboardItem.ItemMetadata(
                    imageData: nil,
                    urlDomain: domain,
                    fileName: nil,
                    fileExtension: nil
                )
            } else {
                itemType = .text
                metadata = nil
            }
            
            addNewItem(content: string, type: itemType, metadata: metadata)
        } else if let imageData = pasteboard.data(forType: .png) ?? pasteboard.data(forType: .jpeg) {
            let metadata = ClipboardItem.ItemMetadata(
                imageData: imageData,
                urlDomain: nil,
                fileName: nil,
                fileExtension: nil
            )
            addNewItem(content: "Image", type: .image, metadata: metadata)
        } else if let fileURL = pasteboard.readObjects(forClasses: [NSURL.self])?.first as? URL {
            let fileName = fileURL.lastPathComponent
            let fileExtension = fileURL.pathExtension
            let metadata = ClipboardItem.ItemMetadata(
                imageData: nil,
                urlDomain: nil,
                fileName: fileName,
                fileExtension: fileExtension.isEmpty ? nil : fileExtension
            )
            addNewItem(content: fileName, type: .file, metadata: metadata)
        }
    }
    
    private func addNewItem(content: String, type: ClipboardItem.ItemType, metadata: ClipboardItem.ItemMetadata?) -> Void {
        let newItem = ClipboardItem(
            content: content,
            type: type,
            timestamp: Date(),
            metadata: metadata
        )
        
        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
            clipboardItems.insert(newItem, at: 0)
            
            if clipboardItems.count > maxItems {
                clipboardItems.removeLast()
            }
        }
        
        persistItems()
        archiveToProject()
    }
    
    private func cleanupOldItems() -> Void {
        let sevenDaysAgo = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
        
        let itemsToRemove = clipboardItems.filter { $0.timestamp < sevenDaysAgo }
        
        if !itemsToRemove.isEmpty {
            withAnimation(.easeInOut(duration: 0.3)) {
                clipboardItems.removeAll { item in
                    itemsToRemove.contains { $0.id == item.id }
                }
            }
            persistItems()
        }
    }
    
    private func loadPersistedItems() -> Void {
        // Implementation placeholder
    }
    
    private func persistItems() -> Void {
        // Implementation placeholder
    }
    
    private func archiveToProject() -> Void {
        // Implementation placeholder
    }
}

struct ItemPreview: View {
    let item: ClipboardItem
    let daysSinceCapture: Int
    
    var body: some View {
        VStack(spacing: 8) {
            HStack {
                typeIcon
                    .foregroundColor(typeColor)
                Spacer()
                Text(timeLabel)
                    .font(.system(size: 11, weight: .regular))
                    .foregroundColor(.tertiary)
            }
            
            Spacer()
            
            contentView
            
            Spacer()
        }
        .padding(12)
        .frame(height: 100)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(Color.primary.opacity(0.1), lineWidth: 1)
        )
        .onTapGesture {
            copyToPasteboard()
        }
    }
    
    private var typeIcon: some View {
        Image(systemName: iconName)
            .font(.system(size: 11, weight: .medium))
    }
    
    private var typeColor: Color {
        switch item.type {
        case .text: return Color.primary
        case .url: return Color.blue
        case .image: return Color.purple
        case .file: return Color.orange
        }
    }
    
    private var iconName: String {
        switch item.type {
        case .text: return "text.alignleft"
        case .url: return "link"
        case .image: return "photo"
        case .file: return "doc"
        }
    }
    
    private var timeLabel: String {
        if daysSinceCapture == 0 {
            return "today"
        } else if daysSinceCapture == 1 {
            return "yesterday"
        } else {
            return "\(daysSinceCapture)d ago"
        }
    }
    
    private var contentView: some View {
        Group {
            if item.type == .image, let imageData = item.metadata?.imageData, let nsImage = NSImage(data: imageData) {
                Image(nsImage: nsImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 40, height: 30)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            } else {
                Text(displayContent)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundColor(.primary)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
        }
    }
    
    private var displayContent: String {
        switch item.type {
        case .url:
            return item.metadata?.urlDomain ?? item.content
        case .file:
            return item.metadata?.fileName ?? item.content
        default:
            return item.content
        }
    }
    
    private func copyToPasteboard() -> Void {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(item.content, forType: .string)
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