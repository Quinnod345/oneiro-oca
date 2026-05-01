import SwiftUI
import UniformTypeIdentifiers
import AppKit

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

struct SlotView: View {
    let item: SlotItem?
    let isHovering: Bool
    
    var body: some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(item != nil ? Color(red: 0.9, green: 0.88, blue: 0.85) : Color(red: 0.95, green: 0.94, blue: 0.92))
            .frame(width: 120, height: 120)
            .overlay(
                Group {
                    if let item = item {
                        VStack {
                            Image(systemName: iconName(for: item.type))
                                .font(.system(size: 32))
                                .foregroundColor(Color(red: 0.4, green: 0.35, blue: 0.3))
                            Text(item.title)
                                .font(.system(size: 12))
                                .lineLimit(2)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 8)
                                .foregroundColor(Color(red: 0.3, green: 0.25, blue: 0.2))
                        }
                    } else {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 32))
                            .foregroundColor(Color.gray.opacity(0.3))
                    }
                }
            )
            .scaleEffect(isHovering ? 1.05 : 1.0)
            .animation(.easeInOut(duration: 0.2), value: isHovering)
    }
    
    func iconName(for type: ItemType) -> String {
        switch type {
        case .text:
            return "doc.text"
        case .image:
            return "photo"
        case .file:
            return "doc"
        case .url:
            return "link"
        }
    }
}

struct ContentView: View {
    @StateObject private var slotManager = SlotManager()
    @State private var hoveredIndex: Int? = nil
    @State private var isDraggingOver: Bool = false
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Memory Shelf")
                .font(.system(size: 28, weight: .bold, design: .serif))
                .foregroundColor(Color(red: 0.3, green: 0.25, blue: 0.2))
            
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(120), spacing: 16), count: 4), spacing: 16) {
                ForEach(0..<8) { index in
                    let item = index < slotManager.items.count ? slotManager.items[index] : nil
                    
                    SlotView(item: item, isHovering: hoveredIndex == index || (isDraggingOver && item == nil))
                        .onHover { hovering in
                            hoveredIndex = hovering ? index : nil
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
            .padding(20)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color(red: 0.98, green: 0.97, blue: 0.95))
                    .shadow(color: Color.black.opacity(0.1), radius: 10, x: 0, y: 4)
            )
        }
        .frame(width: 600, height: 400)
        .background(Color(red: 0.96, green: 0.95, blue: 0.93))
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
                provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { url, _ in
                    if let url = url as? URL {
                        DispatchQueue.main.async {
                            let data = url.absoluteString.data(using: .utf8) ?? Data()
                            let item = SlotItem(
                                title: url.lastPathComponent,
                                type: .file,
                                data: data,
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
            if let image = NSImage(data: item.data) {
                pasteboard.writeObjects([image])
            }
        case .file, .url:
            if let urlString = String(data: item.data, encoding: .utf8) {
                pasteboard.setString(urlString, forType: .string)
            }
        }
    }
}