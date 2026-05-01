struct ContentView: View {
    @State private var clipboardItems: [ClipboardItem] = []
    @State private var lastPasteboardChangeCount: Int = NSPasteboard.general.changeCount
    
    private let maxItems = 8
    private let checkInterval: TimeInterval = 1.0
    
    var body: some View {
        ZStack {
            Color(red: 0.95, green: 0.93, blue: 0.91)
                .ignoresSafeArea()
            
            VStack(spacing: 20) {
                headerView
                itemGridView
                Spacer()
            }
            .padding(24)
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            loadPersistedItems()
            startClipboardMonitoring()
        }
    }
    
    private var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Sill")
                    .font(.system(size: 32, weight: .light, design: .serif))
                    .foregroundColor(Color(red: 0.2, green: 0.15, blue: 0.1))
                
                Text("Recent captures settle here briefly")
                    .font(.system(size: 13, weight: .regular, design: .default))
                    .foregroundColor(Color(red: 0.5, green: 0.45, blue: 0.4))
            }
            Spacer()
            
            Text("\(clipboardItems.count)/\(maxItems)")
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundColor(Color(red: 0.6, green: 0.55, blue: 0.5))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color(red: 0.88, green: 0.85, blue: 0.82))
                }
        }
    }
    
    private var itemGridView: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 16), count: 4)
        
        LazyVGrid(columns: columns, spacing: 16) {
            ForEach(clipboardItems) { item in
                let daysSince = Calendar.current.dateComponents([.day], from: item.timestamp, to: Date()).day ?? 0
                
                ItemPreview(item: item, daysSinceCapture: daysSince)
                    .onDrag {
                        return NSItemProvider(object: item.content as NSString)
                    }
            }
            
            ForEach(clipboardItems.count..<maxItems, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(
                        Color(red: 0.9, green: 0.87, blue: 0.83),
                        style: StrokeStyle(lineWidth: 1, dash: [4, 4])
                    )
                    .background(Color(red: 0.97, green: 0.95, blue: 0.93))
                    .frame(width: 140, height: 100)
                    .opacity(0.6)
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
        
        clipboardItems.insert(newItem, at: 0)
        
        if clipboardItems.count > maxItems {
            clipboardItems.removeLast()
        }
        
        persistItems()
        archiveToProject()
    }
    
    private func cleanupOldItems() -> Void {
        let sevenDaysAgo = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
        clipboardItems.removeAll { $0.timestamp < sevenDaysAgo }
    }
    
    private func loadPersistedItems() -> Void {
        guard let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let sillPath = documentsPath.appendingPathComponent("sill/items.json")
        
        guard let data = try? Data(contentsOf: sillPath),
              let items = try? JSONDecoder().decode([ClipboardItem].self, from: data) else { return }
        
        clipboardItems = items
    }
    
    private func persistItems() -> Void {
        guard let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let sillPath = documentsPath.appendingPathComponent("sill")
        
        try? FileManager.default.createDirectory(at: sillPath, withIntermediateDirectories: true)
        
        let itemsPath = sillPath.appendingPathComponent("items.json")
        if let data = try? JSONEncoder().encode(clipboardItems) {
            try? data.write(to: itemsPath)
        }
    }
    
    private func archiveToProject() -> Void {
        guard let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let projectPath = documentsPath.appendingPathComponent("active-project/sill/iterations")
        
        try? FileManager.default.createDirectory(at: projectPath, withIntermediateDirectories: true)
        
        let existingFiles = (try? FileManager.default.contentsOfDirectory(at: projectPath, includingPropertiesForKeys: nil)) ?? []
        let iterNumbers = existingFiles.compactMap { url -> Int? in
            let name = url.deletingPathExtension().lastPathComponent
            guard name.hasPrefix("iter-") else { return nil }
            return Int(String(name.dropFirst(5)))
        }
        
        let nextIter = (iterNumbers.max() ?? -1) + 1
        let iterFileName = String(format: "iter-%04d.json", nextIter)
        let iterPath = projectPath.appendingPathComponent(iterFileName)
        
        if let data = try? JSONEncoder().encode(clipboardItems) {
            try? data.write(to: iterPath)
        }
    }
}