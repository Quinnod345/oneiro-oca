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
                        .fill(.regularMaterial)
                }
        }
    }
    
    private func itemGridView(for width: CGFloat) -> some View {
        let columnCount = max(2, min(4, Int((width - 64) / 180)))
        let columns = Array(repeating: GridItem(.flexible(), spacing: 20), count: columnCount)
        
        return LazyVGrid(columns: columns, spacing: 20) {
            ForEach(Array(clipboardItems.enumerated()), id: \.element.id) { index, item in
                let daysSince = Calendar.current.dateComponents([.day], from: item.timestamp, to: Date()).day ?? 0
                let isRecent = index < 2
                
                ItemPreview(item: item, daysSinceCapture: daysSince, isRecent: isRecent)
                    .transition(.asymmetric(
                        insertion: .scale(scale: 0.8).combined(with: .opacity).combined(with: .offset(y: -20)),
                        removal: .scale(scale: 0.9).combined(with: .opacity)
                    ))
                    .animation(.spring(response: 0.5, dampingFraction: 0.7).delay(Double(index) * 0.1), value: clipboardItems.count)
                    .onDrag {
                        return NSItemProvider(object: item.content as NSString)
                    }
            }
            
            ForEach(clipboardItems.count..<maxItems, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(
                        Color.secondary.opacity(0.2),
                        style: StrokeStyle(lineWidth: 1, dash: [8, 6])
                    )
                    .background(.ultraThinMaterial.opacity(0.2))
                    .frame(height: 100)
                    .opacity(0.3)
            }
        }
    }
    
    private func startClipboardMonitoring() {
        Timer.scheduledTimer(withTimeInterval: checkInterval, repeats: true) { _ in
            checkClipboardChanges()
        }
    }
    
    private func checkClipboardChanges() {
        let currentChangeCount = NSPasteboard.general.changeCount
        
        if currentChangeCount != lastPasteboardChangeCount {
            lastPasteboardChangeCount = currentChangeCount
            processNewClipboardContent()
        }
        
        cleanupOldItems()
    }
    
    private func processNewClipboardContent() {
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
    
    private func addNewItem(content: String, type: ClipboardItem.ItemType, metadata: ClipboardItem.ItemMetadata?) {
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
    }
    
    private func cleanupOldItems() {
        let cutoffDate = Calendar.current.date(byAdding: .hour, value: -24, to: Date()) ?? Date()
        let initialCount = clipboardItems.count
        
        clipboardItems.removeAll { $0.timestamp < cutoffDate }
        
        if clipboardItems.count != initialCount {
            persistItems()
        }
    }
    
    private func persistItems() {
        if let encoded = try? JSONEncoder().encode(clipboardItems) {
            UserDefaults.standard.set(encoded, forKey: "ClipboardItems")
        }
    }
    
    private func loadPersistedItems() {
        guard let data = UserDefaults.standard.data(forKey: "ClipboardItems"),
              let items = try? JSONDecoder().decode([ClipboardItem].self, from: data) else {
            return
        }
        clipboardItems = items
    }
}

struct ItemPreview: View {
    let item: ClipboardItem
    let daysSinceCapture: Int
    let isRecent: Bool
    @State private var isHovered = false
    @State private var pulseAnimation = false
    
    private var accentColor: Color {
        switch item.type {
        case .text: return .primary
        case .url: return .blue
        case .image: return .purple
        case .file: return .orange
        }
    }
    
    private var itemHeight: CGFloat {
        switch item.type {
        case .image: return 120
        case .url: return 110
        case .file: return 105
        case .text: return 100
        }
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                typeIcon
                    .foregroundColor(accentColor)
                
                Spacer()
                
                if isRecent {
                    Circle()
                        .fill(accentColor)
                        .frame(width: 6, height: 6)
                        .scaleEffect(pulseAnimation ? 1.2 : 1.0)
                        .opacity(pulseAnimation ? 0.6 : 1.0)
                        .animation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true), value: pulseAnimation)
                }
            }
            
            contentView
                .lineLimit(3)
                .multilineTextAlignment(.leading)
            
            Spacer()
            
            HStack {
                timestampView
                Spacer()
            }
        }
        .padding(16)
        .frame(height: itemHeight)
        .background {
            RoundedRectangle(cornerRadius: 12)
                .fill(.regularMaterial)
                .shadow(color: isRecent ? accentColor.opacity(0.2) : Color.black.opacity(0.1), 
                       radius: isRecent ? 8 : 4, x: 0, y: isRecent ? 4 : 2)
        }
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(accentColor.opacity(isHovered ? 0.4 : 0.15), lineWidth: isHovered ? 2 : 1)
        }
        .scaleEffect(isHovered ? 1.02 : 1.0)
        .onHover { hovering in
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                isHovered = hovering
            }
        }
        .onTapGesture {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(item.content, forType: .string)
        }
        .onAppear {
            if isRecent {
                pulseAnimation = true
            }
        }
    }
    
    private var typeIcon: some View {
        Group {
            switch item.type {
            case .text:
                Image(systemName: "text.alignleft")
            case .url:
                Image(systemName: "link")
            case .image:
                Image(systemName: "photo")
            case .file:
                Image(systemName: "doc")
            }
        }
        .font(.system(size: 14, weight: .medium))
    }
    
    private var contentView: some View {
        VStack(alignment: .leading, spacing: 4) {
            if item.type == .image, let imageData = item.metadata?.imageData, let nsImage = NSImage(data: imageData) {
                Image(nsImage: nsImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(height: 50)
                    .clipped()
                    .cornerRadius(6)
            } else {
                Text(displayContent)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundColor(.primary)
                
                if let subtitle = displaySubtitle {
                    Text(subtitle)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(accentColor)
                }
            }
        }
    }
    
    private var displayContent: String {
        switch item.type {
        case .text:
            return item.content.trimmingCharacters(in: .whitespacesAndNewlines)
        case .url:
            return item.content
        case .file:
            return item.metadata?.fileName ?? item.content
        case .image:
            return "Image"
        }
    }
    
    private var displaySubtitle: String? {
        switch item.type {
        case .url:
            return item.metadata?.urlDomain
        case .file:
            return item.metadata?.fileExtension?.uppercased()
        default:
            return nil
        }
    }
    
    private var timestampView: some View {
        Text(relativeTimeString)
            .font(.system(size: 10, weight: .medium))
            .foregroundColor(.secondary)
    }
    
    private var relativeTimeString: String {
        let now = Date()
        let timeInterval = now.timeIntervalSince(item.timestamp)
        
        if timeInterval < 60 {
            return "Just now"
        } else if timeInterval < 3600 {
            let minutes = Int(timeInterval / 60)
            return "\(minutes)m ago"
        } else if timeInterval < 86400 {
            let hours = Int(timeInterval / 3600)
            return "\(hours)h ago"
        } else {
            return "\(daysSinceCapture)d ago"
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
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}