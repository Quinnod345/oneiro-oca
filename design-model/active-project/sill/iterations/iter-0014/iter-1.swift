struct ContentView: View {
    @State private var shelfItems: [ShelfItem] = [
        ShelfItem(name: "Notes", type: .document, preview: "Meeting notes from...", daysOld: 2),
        ShelfItem(name: "Design", type: .image, preview: "Wireframes and mockups", daysOld: 1),
        ShelfItem(name: "Code", type: .code, preview: "SwiftUI components", daysOld: 0),
        ShelfItem(name: "Brief", type: .pdf, preview: "Project requirements", daysOld: 5),
        ShelfItem(name: "Demo", type: .video, preview: "Screen recording", daysOld: 6),
        ShelfItem(isEmpty: true),
        ShelfItem(isEmpty: true),
        ShelfItem(isEmpty: true)
    ]
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
                .ignoresSafeArea()
            
            VStack {
                Spacer()
                
                HStack(spacing: 16) {
                    ForEach(Array(shelfItems.enumerated()), id: \.element.id) { index, item in
                        ShelfSlot(item: item, slotIndex: index)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 16)
                .background(.hudMaterial, in: RoundedRectangle(cornerRadius: 16))
                .shadow(color: .black.opacity(0.2), radius: 12, x: 0, y: 8)
                
                Spacer().frame(height: 60)
            }
        }
        .frame(width: 1440, height: 900)
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