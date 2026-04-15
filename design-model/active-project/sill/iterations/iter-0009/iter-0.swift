import SwiftUI
import UniformTypeIdentifiers

struct ShelfItem: Codable, Identifiable {
    let id = UUID()
    let content: String
    let type: ItemType
    let dateAdded: Date
    
    enum ItemType: String, Codable, CaseIterable {
        case text, file, url
    }
    
    var ageOpacity: Double {
        let daysSinceAdded = Date().timeIntervalSince(dateAdded) / 86400
        return daysSinceAdded > 7 ? max(0.3, 1.0 - (daysSinceAdded - 7) * 0.1) : 1.0
    }
    
    var displayText: String {
        switch type {
        case .text:
            return String(content.prefix(40))
        case .file:
            return URL(fileURLWithPath: content).lastPathComponent
        case .url:
            return content
        }
    }
    
    var fileExtension: String? {
        guard type == .file else { return nil }
        let ext = URL(fileURLWithPath: content).pathExtension.lowercased()
        return ext.isEmpty ? nil : ext
    }
}

class ShelfStore: ObservableObject {
    @Published var items: [ShelfItem] = []
    private let saveURL: URL
    
    init() {
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        saveURL = documentsPath.appendingPathComponent("shelf_items.json")
        loadItems()
    }
    
    func addItem(_ item: ShelfItem) {
        if items.count >= 8 {
            items.removeFirst()
        }
        items.append(item)
        saveItems()
    }
    
    func removeItem(at index: Int) {
        guard index < items.count else { return }
        items.remove(at: index)
        saveItems()
    }
    
    private func saveItems() {
        do {
            let data = try JSONEncoder().encode(items)
            try data.write(to: saveURL)
        } catch {}
    }
    
    private func loadItems() {
        do {
            let data = try Data(contentsOf: saveURL)
            items = try JSONDecoder().decode([ShelfItem].self, from: data)
        } catch {}
    }
}

struct ItemPreviewIcon: View {
    let item: ShelfItem
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 4)
                .fill(Color(red: 0.95, green: 0.95, blue: 0.97))
                .frame(width: 28, height: 28)
            
            switch item.type {
            case .file:
                if let ext = item.fileExtension {
                    VStack(spacing: 1) {
                        Image(systemName: "doc.fill")
                            .font(.system(size: 10))
                            .foregroundColor(Color(red: 0.4, green: 0.4, blue: 0.45))
                        Text(ext.uppercased())
                            .font(.system(size: 6, weight: .medium))
                            .foregroundColor(Color(red: 0.3, green: 0.3, blue: 0.35))
                    }
                } else {
                    Image(systemName: "doc")
                        .font(.system(size: 14))
                        .foregroundColor(Color(red: 0.4, green: 0.4, blue: 0.45))
                }
            case .text:
                Image(systemName: "text.alignleft")
                    .font(.system(size: 12))
                    .foregroundColor(Color(red: 0.2, green: 0.4, blue: 0.8))
            case .url:
                RoundedRectangle(cornerRadius: 3)
                    .fill(Color(red: 0.8, green: 0.85, blue: 0.9))
                    .frame(width: 18, height: 18)
                    .overlay(
                        Image(systemName: "globe")
                            .font(.system(size: 8))
                            .foregroundColor(Color(red: 0.3, green: 0.5, blue: 0.7))
                    )
            }
        }
    }
}

struct ShelfSlot: View {
    let index: Int
    let item: ShelfItem?
    let isHighlighted: Bool
    let onRemove: () -> Void
    
    @State private var isPressed: Bool = false
    @State private var hasJustInserted: Bool = false
    
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(
                isHighlighted ? 
                Color(red: 0.88, green: 0.82, blue: 0.72) :
                Color(red: 0.92, green: 0.88, blue: 0.82)
            )
            .frame(width: 120, height: 80)
            .overlay(
                Group {
                    if let item = item {
                        VStack(spacing: 8) {
                            ItemPreviewIcon(item: item)
                            
                            Text(item.displayText)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(Color(red: 0.25, green: 0.25, blue: 0.3))
                                .lineLimit(2)
                                .multilineTextAlignment(.center)
                        }
                        .padding(8)
                        .opacity(item.ageOpacity)
                        .scaleEffect(hasJustInserted ? 0.8 : 1.0)
                        .opacity(hasJustInserted ? 0.0 : 1.0)
                        .animation(.spring(response: 0.6, dampingFraction: 0.7), value: hasJustInserted)
                        .onAppear {
                            if hasJustInserted {
                                withAnimation {
                                    hasJustInserted = false
                                }
                            }
                        }
                    } else {
                        Circle()
                            .fill(Color(red: 0.85, green: 0.8, blue: 0.7))
                            .frame(width: 6, height: 6)
                            .opacity(0.4)
                    }
                }
            )
            .scaleEffect(isPressed ? 0.95 : 1.0)
            .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isPressed)
            .animation(.spring(response: 0.5, dampingFraction: 0.6), value: isHighlighted)
            .onTapGesture {
                if item != nil {
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) {
                        isPressed = true
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) {
                            isPressed = false
                        }
                        onRemove()
                    }
                }
            }
            .onChange(of: item) { _, newItem in
                if newItem != nil {
                    hasJustInserted = true
                }
            }
    }
}

struct ContentView: View {
    @StateObject private var store: ShelfStore = ShelfStore()
    @State private var draggedItem: ShelfItem? = nil
    @State private var highlightedSlot: Int? = nil
    
    var body: some View {
        VStack(spacing: 0) {
            // Title bar
            HStack {
                Text("Shelf")
                    .font(.system(size: 18, weight: .medium, design: .rounded))
                    .foregroundColor(Color(red: 0.2, green: 0.2, blue: 0.25))
                Spacer()
                Text("\(store.items.count)/8")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundColor(Color(red: 0.5, green: 0.5, blue: 0.55))
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            .background(Color(red: 0.97, green: 0.95, blue: 0.92))
            
            // Shelf area
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(0..<8, id: \.self) { index in
                        let item = index < store.items.count ? store.items[index] : nil
                        ShelfSlot(
                            index: index,
                            item: item,
                            isHighlighted: highlightedSlot == index,
                            onRemove: {
                                store.removeItem(at: index)
                            }
                        )
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
            .background(Color(red: 0.94, green: 0.91, blue: 0.86))
            .onDrop(of: [.text, .fileURL, .url], isTargeted: nil) { providers, location in
                handleDrop(providers: providers, at: location)
                return true
            }
            .gesture(
                DragGesture(coordinateSpace: .global)
                    .onChanged { value in
                        updateHighlightedSlot(for: value.location)
                    }
                    .onEnded { _ in
                        highlightedSlot = nil
                    }
            )
        }
        .frame(width: 1440, height: 900)
        .background(Color(red: 0.96, green: 0.94, blue: 0.91))
    }
    
    private func handleDrop(providers: [NSItemProvider], at location: CGPoint) -> Bool {
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    if let url = url {
                        DispatchQueue.main.async {
                            let item = ShelfItem(content: url.path, type: .file, dateAdded: Date())
                            store.addItem(item)
                        }
                    }
                }
                return true
            } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    if let url = url {
                        DispatchQueue.main.async {
                            let item = ShelfItem(content: url.absoluteString, type: .url, dateAdded: Date())
                            store.addItem(item)
                        }
                    }
                }
                return true
            } else if provider.hasItemConformingToTypeIdentifier(UTType.text.identifier) {
                _ = provider.loadObject(ofClass: String.self) { text, _ in
                    if let text = text {
                        DispatchQueue.main.async {
                            let item = ShelfItem(content: text, type: .text, dateAdded: Date())
                            store.addItem(item)
                        }
                    }
                }
                return true
            }
        }
        return false
    }
    
    private func updateHighlightedSlot(for location: CGPoint) {
        let slotWidth: CGFloat = 120 + 12
        let startX: CGFloat = 20
        let slotIndex = Int((location.x - startX) / slotWidth)
        
        if slotIndex >= 0 && slotIndex < 8 {
            highlightedSlot = slotIndex
        } else {
            highlightedSlot = nil
        }
    }
}