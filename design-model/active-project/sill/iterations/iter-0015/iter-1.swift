import SwiftUI
import UniformTypeIdentifiers

enum ItemType {
    case text
    case image
    case file
    case url
}

struct SlotItem: Identifiable {
    let id = UUID()
    let title: String
    let type: ItemType
    let data: Data
    let createdAt: Date
}

class SlotManager: ObservableObject {
    @Published var items: [SlotItem] = []
    
    func addItem(_ item: SlotItem) {
        if items.count < 8 {
            items.append(item)
        }
    }
    
    func removeItem(_ item: SlotItem) {
        items.removeAll { $0.id == item.id }
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

struct SlotView: View {
    let item: SlotItem?
    let isHovering: Bool
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(item != nil ? Color.gray.opacity(0.2) : Color.gray.opacity(0.1))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(isHovering ? Color.blue : Color.gray.opacity(0.3), lineWidth: 2)
                )
            
            if let item = item {
                VStack {
                    Image(systemName: iconName(for: item.type))
                        .font(.system(size: 32))
                        .foregroundColor(.primary)
                    
                    Text(item.title)
                        .font(.caption)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                        .foregroundColor(.secondary)
                }
                .padding(8)
            } else {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 32))
                    .foregroundColor(.gray.opacity(0.3))
            }
        }
        .frame(width: 120, height: 120)
        .scaleEffect(isHovering ? 1.05 : 1.0)
        .animation(.easeInOut(duration: 0.2), value: isHovering)
    }
    
    func iconName(for type: ItemType) -> String {
        switch type {
        case .text:
            return "doc.text.fill"
        case .image:
            return "photo.fill"
        case .file:
            return "doc.fill"
        case .url:
            return "link.circle.fill"
        }
    }
}

struct ContentView: View {
    @StateObject private var slotManager = SlotManager()
    @State private var hoveredIndex: Int? = nil
    @State private var isDraggingOver: Bool = false
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .windowBackground, blendingMode: .behindWindow)
                .ignoresSafeArea()
            
            VStack(spacing: 24) {
                Text("Memory Shelf")
                    .font(.largeTitle)
                    .fontWeight(.semibold)
                    .foregroundColor(.primary)
                
                ZStack {
                    VisualEffectView(material: .contentBackground, blendingMode: .withinWindow)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    
                    LazyVGrid(columns: Array(repeating: GridItem(.fixed(120), spacing: 16), count: 4), spacing: 16) {
                        ForEach(0..<8) { index in
                            let item = index < slotManager.items.count ? slotManager.items[index] : nil
                            
                            SlotView(item: item, isHovering: hoveredIndex == index || (isDraggingOver && item == nil))
                                .onHover { hovering in
                                    hoveredIndex = hovering ? index : nil
                                    if hovering {
                                        NSCursor.pointingHand.push()
                                    } else {
                                        NSCursor.pop()
                                    }
                                }
                                .onTapGesture {
                                    if let item = item {
                                        copyToPasteboard(item)
                                    }
                                }
                                .contextMenu {
                                    if let item = item {
                                        Button("Copy") {
                                            copyToPasteboard(item)
                                        }
                                        Button("Remove") {
                                            slotManager.removeItem(item)
                                        }
                                    }
                                }
                                .onDrop(of: [.fileURL, .utf8PlainText, .image], isTargeted: .constant(false)) { providers in
                                    handleDrop(providers)
                                    return true
                                }
                        }
                    }
                    .padding(24)
                }
            }
            .padding(32)
        }
        .frame(width: 600, height: 400)
        .onDrop(of: [.fileURL, .utf8PlainText, .image], isTargeted: $isDraggingOver) { providers in
            handleDrop(providers)
            return true
        }
    }
    
    func handleDrop(_ providers: [NSItemProvider]) {
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.utf8PlainText.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.utf8PlainText.identifier, options: nil) { data, _ in
                    if let data = data as? Data,
                       let text = String(data: data, encoding: .utf8) {
                        DispatchQueue.main.async {
                            let item = SlotItem(
                                title: String(text.prefix(30)),
                                type: .text,
                                data: data,
                                createdAt: Date()
                            )
                            slotManager.addItem(item)
                        }
                    }
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { data, _ in
                    if let data = data as? Data {
                        DispatchQueue.main.async {
                            let item = SlotItem(
                                title: "Image",
                                type: .image,
                                data: data,
                                createdAt: Date()
                            )
                            slotManager.addItem(item)
                        }
                    }
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { data, _ in
                    if let url = data as? URL {
                        DispatchQueue.main.async {
                            let item = SlotItem(
                                title: url.lastPathComponent,
                                type: .file,
                                data: url.dataRepresentation,
                                createdAt: Date()
                            )
                            slotManager.addItem(item)
                        }
                    }
                }
            }
        }
    }
    
    func copyToPasteboard(_ item: SlotItem) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        
        switch item.type {
        case .text:
            if let text = String(data: item.data, encoding: .utf8) {
                pasteboard.setString(text, forType: .string)
            }
        case .image:
            pasteboard.setData(item.data, forType: .png)
        case .file:
            if let url = URL(dataRepresentation: item.data, relativeTo: nil) {
                pasteboard.setString(url.absoluteString, forType: .fileURL)
            }
        case .url:
            if let urlString = String(data: item.data, encoding: .utf8) {
                pasteboard.setString(urlString, forType: .string)
            }
        }
    }
}