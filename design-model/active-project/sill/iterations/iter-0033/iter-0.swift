import SwiftUI

struct ShelfItem: Codable, Identifiable {
    let id = UUID()
    let filePath: String
    let fileName: String
    let addedDate: Date
    
    var ageInDays: Int {
        let calendar = Calendar.current
        let components = calendar.dateComponents([.day], from: addedDate, to: Date())
        return components.day ?? 0
    }
}

struct ContentView: View {
    @State private var shelfItems: [ShelfItem] = []
    private let maxSlots: Int = 8
    private let documentsURL: URL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
    
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Temporal Shelf")
                    .font(.system(size: 14, weight: .semibold, design: .serif))
                    .foregroundColor(Color(red: 0.3, green: 0.2, blue: 0.1))
                
                Spacer()
                
                Button(action: clearExpiredItems) {
                    Image(systemName: "wind")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(Color(red: 0.6, green: 0.4, blue: 0.2))
                }
                .buttonStyle(PlainButtonStyle())
                .help("Clear aged items")
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 8)
            
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(red: 0.85, green: 0.75, blue: 0.6),
                                Color(red: 0.8, green: 0.68, blue: 0.52)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .shadow(color: Color.black.opacity(0.25), radius: 8, x: 0, y: 4)
                
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(80), spacing: 12), count: 4), spacing: 12) {
                    ForEach(0..<maxSlots, id: \.self) { index in
                        if index < shelfItems.count {
                            ShelfItemView(item: shelfItems[index], index: index)
                        } else {
                            EmptySlotView(index: index)
                        }
                    }
                }
                .padding(16)
            }
            .frame(width: 400, height: 200)
            .padding(.horizontal, 20)
            .padding(.bottom, 16)
        }
        .frame(width: 440, height: 260)
        .background(Color(red: 0.98, green: 0.97, blue: 0.94))
        .onDrop(of: ["public.file-url"], isTargeted: nil) { providers in
            handleDrop(providers: providers)
        }
        .onAppear {
            loadItems()
        }
    }
    
    private func handleDrop(providers: [NSItemProvider]) -> Bool {
        guard shelfItems.count < maxSlots else { return false }
        
        for provider in providers {
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                if let url = url, url.isFileURL {
                    DispatchQueue.main.async {
                        addItem(from: url)
                    }
                }
            }
        }
        return true
    }
    
    private func addItem(from url: URL) {
        guard shelfItems.count < maxSlots else { return }
        
        let fileName: String = url.lastPathComponent
        let newItem: ShelfItem = ShelfItem(
            filePath: url.path,
            fileName: fileName,
            addedDate: Date()
        )
        
        shelfItems.append(newItem)
        saveItems()
    }
    
    private func clearExpiredItems() {
        shelfItems.removeAll { $0.ageInDays > 7 }
        saveItems()
    }
    
    private func saveItems() {
        let saveURL: URL = documentsURL.appendingPathComponent("shelf_items.json")
        do {
            let data: Data = try JSONEncoder().encode(shelfItems)
            try data.write(to: saveURL)
        } catch {
            // Silent fail for this prototype
        }
    }
    
    private func loadItems() {
        let loadURL: URL = documentsURL.appendingPathComponent("shelf_items.json")
        do {
            let data: Data = try Data(contentsOf: loadURL)
            shelfItems = try JSONDecoder().decode([ShelfItem].self, from: data)
        } catch {
            // Silent fail - start with empty shelf
        }
    }
}

struct ShelfItemView: View {
    let item: ShelfItem
    let index: Int
    
    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: "doc.fill")
                .font(.system(size: 24))
                .foregroundColor(Color(red: 0.4, green: 0.3, blue: 0.2))
            
            Text(item.fileName)
                .font(.system(size: 9))
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .foregroundColor(Color(red: 0.3, green: 0.2, blue: 0.1))
            
            Text("\(item.ageInDays)d")
                .font(.system(size: 8, weight: .medium, design: .monospaced))
                .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
        }
        .frame(width: 80, height: 80)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.white.opacity(0.7))
                .shadow(color: Color.black.opacity(0.1), radius: 2, x: 0, y: 1)
        )
    }
}

struct EmptySlotView: View {
    let index: Int
    
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .strokeBorder(Color(red: 0.7, green: 0.6, blue: 0.5), lineWidth: 1, antialiased: true)
            .frame(width: 80, height: 80)
            .overlay(
                Image(systemName: "plus")
                    .font(.system(size: 16))
                    .foregroundColor(Color(red: 0.6, green: 0.5, blue: 0.4))
            )
    }
}