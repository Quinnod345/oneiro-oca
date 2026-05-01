struct ClipboardItem: Identifiable, Codable {
    let id = UUID()
    let content: String
    let type: ItemType
    let timestamp: Date
    var lastAccessed: Date
    
    enum ItemType: Codable {
        case text
        case image(Data)
        case url
        case file(String) // file extension
    }
    
    var isDecayed: Bool {
        Date().timeIntervalSince(lastAccessed) > 7 * 24 * 60 * 60
    }
}

class ClipboardManager: ObservableObject {
    @Published var items: [ClipboardItem] = []
    private let maxItems = 8
    private let saveURL: URL
    
    init() {
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        saveURL = documentsPath.appendingPathComponent("clipboard_shelf.json")
        loadItems()
        startMonitoring()
    }
    
    private func startMonitoring() {
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            self.checkPasteboard()
        }
    }
    
    private func checkPasteboard() {
        let pasteboard = NSPasteboard.general
        guard let pasteboardItems = pasteboard.pasteboardItems else { return }
        
        for pbItem in pasteboardItems {
            if let string = pbItem.string(forType: .string) {
                addItem(content: string, type: determineType(for: string, pbItem: pbItem))
            }
        }
    }
    
    private func determineType(for content: String, pbItem: NSPasteboardItem) -> ClipboardItem.ItemType {
        if let imageData = pbItem.data(forType: .tiff) {
            return .image(imageData)
        }
        
        if content.hasPrefix("http://") || content.hasPrefix("https://") {
            return .url
        }
        
        if content.contains(".") && !content.contains(" ") && content.count < 100 {
            let ext = String(content.split(separator: ".").last ?? "")
            return .file(ext)
        }
        
        return .text
    }
    
    private func addItem(content: String, type: ClipboardItem.ItemType) {
        // Avoid duplicates
        if items.first?.content == content { return }
        
        let newItem = ClipboardItem(
            content: content,
            type: type,
            timestamp: Date(),
            lastAccessed: Date()
        )
        
        items.insert(newItem, at: 0)
        if items.count > maxItems {
            items = Array(items.prefix(maxItems))
        }
        
        saveItems()
    }
    
    func accessItem(at index: Int) {
        guard index < items.count else { return }
        items[index].lastAccessed = Date()
        saveItems()
        
        // Copy back to pasteboard
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(items[index].content, forType: .string)
    }
    
    private func saveItems() {
        if let data = try? JSONEncoder().encode(items) {
            try? data.write(to: saveURL)
        }
    }
    
    private func loadItems() {
        if let data = try? Data(contentsOf: saveURL),
           let loadedItems = try? JSONDecoder().decode([ClipboardItem].self, from: data) {
            items = loadedItems
        }
    }
}

struct ContentView: View {
    @StateObject private var clipboardManager: ClipboardManager = ClipboardManager()
    @State private var hoveredIndex: Int? = nil
    
    var body: some View {
        ZStack {
            // Warm wooden background
            LinearGradient(
                colors: [
                    Color(red: 0.95, green: 0.87, blue: 0.73),
                    Color(red: 0.92, green: 0.82, blue: 0.65)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            
            VStack(spacing: 20) {
                // Shelf header
                HStack {
                    Text("Clipboard Shelf")
                        .font(.system(size: 18, weight: .medium, design: .serif))
                        .foregroundColor(Color(red: 0.4, green: 0.3, blue: 0.2))
                    
                    Spacer()
                    
                    Text("\(clipboardManager.items.count)/8")
                        .font(.system(size: 12, weight: .regular, design: .monospaced))
                        .foregroundColor(Color(red: 0.6, green: 0.5, blue: 0.4))
                }
                .padding(.horizontal, 24)
                .padding(.top, 16)
                
                // Items grid
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: 4), spacing: 16) {
                    ForEach(Array(clipboardManager.items.enumerated()), id: \.element.id) { index, item in
                        ItemView(
                            item: item,
                            isHovered: hoveredIndex == index
                        )
                        .onTapGesture {
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                                clipboardManager.accessItem(at: index)
                            }
                        }
                        .onHover { isHovering in
                            withAnimation(.spring(response: 0.2, dampingFraction: 0.8)) {
                                hoveredIndex = isHovering ? index : nil
                            }
                        }
                        .scaleEffect(hoveredIndex == index ? 1.05 : 1.0)
                    }
                    
                    // Empty slots
                    ForEach(clipboardManager.items.count..<8, id: \.self) { _ in
                        EmptySlotView()
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 20)
            }
        }
        .frame(width: 400, height: 300)
    }
}

struct ItemView: View {
    let item: ClipboardItem
    let isHovered: Bool
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.white)
                .shadow(
                    color: Color.black.opacity(0.15),
                    radius: isHovered ? 8 : 4,
                    x: 2,
                    y: 3
                )
            
            VStack(spacing: 4) {
                contentView
                
                Spacer()
                
                // Timestamp
                Text(timeAgoString(from: item.timestamp))
                    .font(.system(size: 8, weight: .regular, design: .monospaced))
                    .foregroundColor(Color(red: 0.6, green: 0.5, blue: 0.4))
            }
            .padding(8)
        }
        .frame(width: 80, height: 80)
        .opacity(item.isDecayed ? 0.4 : 1.0)
    }
    
    @ViewBuilder
    private var contentView: some View {
        switch item.type {
        case .text:
            Text(item.content)
                .font(.system(size: 10, weight: .regular, design: .serif))
                .foregroundColor(Color(red: 0.2, green: 0.2, blue: 0.2))
                .lineLimit(3)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            
        case .image:
            RoundedRectangle(cornerRadius: 4)
                .fill(Color(red: 0.9, green: 0.85, blue: 0.75))
                .overlay(
                    Image(systemName: "photo")
                        .font(.system(size: 20))
                        .foregroundColor(Color(red: 0.7, green: 0.6, blue: 0.4))
                )
                .frame(width: 40, height: 30)
            
        case .url:
            VStack(spacing: 2) {
                Image(systemName: "globe")
                    .font(.system(size: 20))
                    .foregroundColor(Color(red: 0.3, green: 0.5, blue: 0.8))
                
                if let domain = extractDomain(from: item.content) {
                    Text(domain)
                        .font(.system(size: 8, weight: .medium))
                        .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
                        .lineLimit(1)
                }
            }
            
        case .file(let ext):
            VStack(spacing: 2) {
                Image(systemName: symbolForFileExtension(ext))
                    .font(.system(size: 20))
                    .foregroundColor(Color(red: 0.6, green: 0.4, blue: 0.7))
                
                Text(item.content.split(separator: "/").last?.prefix(12) ?? "")
                    .font(.system(size: 8, weight: .medium))
                    .foregroundColor(Color(red: 0.4, green: 0.3, blue: 0.2))
                    .lineLimit(1)
            }
        }
    }
    
    private func extractDomain(from url: String) -> String? {
        guard let urlObj = URL(string: url) else { return nil }
        return urlObj.host
    }
    
    private func symbolForFileExtension(_ ext: String) -> String {
        switch ext.lowercased() {
        case "pdf": return "doc.richtext"
        case "txt", "md": return "doc.text"
        case "jpg", "png", "gif": return "photo"
        case "mp4", "mov": return "video"
        case "mp3", "wav": return "music.note"
        default: return "doc"
        }
    }
    
    private func timeAgoString(from date: Date) -> String {
        let seconds = Int(Date().timeIntervalSince(date))
        let minutes = seconds / 60
        let hours = minutes / 60
        let days = hours / 24
        
        if days > 0 { return "\(days)d" }
        if hours > 0 { return "\(hours)h" }
        if minutes > 0 { return "\(minutes)m" }
        return "now"
    }
}

struct EmptySlotView: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Color.clear)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(
                        Color(red: 0.8, green: 0.7, blue: 0.6),
                        style: StrokeStyle(lineWidth: 1, dash: [4, 4])
                    )
            )
            .frame(width: 80, height: 80)
            .opacity(0.3)
    }
}