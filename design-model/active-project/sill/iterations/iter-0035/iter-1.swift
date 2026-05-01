struct ContentView: View {
    @State private var items: [WindowsillItem] = [
        WindowsillItem(title: "Morning Notes", createdAt: Date().addingTimeInterval(-86400 * 1)),
        WindowsillItem(title: "Project Ideas", createdAt: Date().addingTimeInterval(-86400 * 4)),
        WindowsillItem(title: "Reading List", createdAt: Date().addingTimeInterval(-86400 * 7)),
        WindowsillItem(title: "Quick Thoughts", createdAt: Date().addingTimeInterval(-86400 * 0.5)),
        WindowsillItem(title: "Meeting Notes", createdAt: Date().addingTimeInterval(-86400 * 6))
    ]
    
    private let columns = [
        GridItem(.adaptive(minimum: 200, maximum: 300), spacing: 20),
        GridItem(.adaptive(minimum: 200, maximum: 300), spacing: 20),
        GridItem(.adaptive(minimum: 200, maximum: 300), spacing: 20),
        GridItem(.adaptive(minimum: 200, maximum: 300), spacing: 20)
    ]
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
            
            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Windowsill")
                            .font(.system(.largeTitle, design: .default, weight: .light))
                            .foregroundColor(.primary)
                        
                        Text("Things settle here")
                            .font(.system(.caption, design: .default, weight: .regular))
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                    
                    Text("\(items.count)/8")
                        .font(.system(.caption, design: .default, weight: .medium))
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(
                            Capsule()
                                .fill(.quaternary)
                        )
                }
                .padding(.horizontal, 40)
                .padding(.top, 40)
                
                Spacer()
                
                LazyVGrid(columns: columns, spacing: 20) {
                    ForEach(items) { item in
                        WindowsillItemView(item: item)
                    }
                }
                .padding(.horizontal, 40)
                
                Spacer()
                
                HStack(spacing: 20) {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(.green)
                            .frame(width: 6, height: 6)
                        
                        Text("Fresh")
                            .font(.system(.caption2, design: .default, weight: .medium))
                            .foregroundColor(.secondary)
                    }
                    
                    HStack(spacing: 6) {
                        Circle()
                            .fill(.orange)
                            .frame(width: 6, height: 6)
                        
                        Text("Settling")
                            .font(.system(.caption2, design: .default, weight: .medium))
                            .foregroundColor(.secondary)
                    }
                    
                    HStack(spacing: 6) {
                        Circle()
                            .fill(.brown)
                            .frame(width: 6, height: 6)
                        
                        Text("Weathered")
                            .font(.system(.caption2, design: .default, weight: .medium))
                            .foregroundColor(.secondary)
                    }
                }
                .padding(.bottom, 30)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let visualEffectView = NSVisualEffectView()
        visualEffectView.material = material
        visualEffectView.blendingMode = blendingMode
        visualEffectView.state = .active
        return visualEffectView
    }
    
    func updateNSView(_ visualEffectView: NSVisualEffectView, context: Context) {
        visualEffectView.material = material
        visualEffectView.blendingMode = blendingMode
    }
}