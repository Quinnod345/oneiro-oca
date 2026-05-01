struct ContentView: View {
    @State private var clipboardItems: [ClipboardItem] = []
    @State private var lastPasteboardChangeCount: Int = NSPasteboard.general.changeCount
    
    private let maxItems = 8
    private let checkInterval: TimeInterval = 1.0
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
                .ignoresSafeArea()
            
            VStack(spacing: 24) {
                headerView
                itemGridView
                Spacer()
            }
            .padding(32)
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            loadPersistedItems()
            startClipboardMonitoring()
        }
    }
    
    private var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                Text("Sill")
                    .font(.system(size: 36, weight: .light, design: .default))
                    .foregroundColor(.primary)
                
                Text("Recent captures settle here briefly")
                    .font(.system(size: 14, weight: .regular))
                    .foregroundColor(.secondary)
            }
            Spacer()
            
            Text("\(clipboardItems.count)/\(maxItems)")
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundColor(.secondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(.thickMaterial)
                }
        }
    }
    
    private var itemGridView: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 20), count: 4)
        
        LazyVGrid(columns: columns, spacing: 20) {
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
                        .tertiary,
                        style: StrokeStyle(lineWidth: 1, dash: [6, 4])
                    )
                    .background(.ultraThinMaterial.opacity(0.5))
                    .frame(width: 140, height: 100)
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
        let oldCount = clipboardItems.count
        clipboardItems.removeAll { $0.timestamp < sevenDaysAgo }
        
        if clipboardItems.count != oldCount {
            persistItems()
        }
    }
    
    private func loadPersistedItems() -> Void {
        if let data = UserDefaults.standard.data(forKey: "clipboardItems"),
           let items = try? JSONDecoder().decode([ClipboardItem].self, from: data) {
            clipboardItems = items
        }
    }
    
    private func persistItems() -> Void {
        if let data = try? JSONEncoder().encode(clipboardItems) {
            UserDefaults.standard.set(data, forKey: "clipboardItems")
        }
    }
    
    private func archiveToProject() -> Void {
        // Placeholder for project archiving functionality
    }
}

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = blendingMode
        return view
    }
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}