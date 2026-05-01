struct ClipboardItem: Identifiable {
    let id = UUID()
    let content: String
    let type: ItemType
    let isDecayed: Bool
    
    enum ItemType {
        case text
        case url
        case image
    }
}

class ClipboardManager: ObservableObject {
    @Published var items: [ClipboardItem] = [
        ClipboardItem(content: "Hello World", type: .text, isDecayed: false),
        ClipboardItem(content: "https://example.com", type: .url, isDecayed: false),
        ClipboardItem(content: "Image data", type: .image, isDecayed: true),
        ClipboardItem(content: "Another text item", type: .text, isDecayed: false)
    ]
    
    func accessItem(at index: Int) {
        guard index < items.count else { return }
        let item = items.remove(at: index)
        items.insert(item, at: 0)
    }
}

struct ContentView: View {
    @StateObject private var clipboardManager = ClipboardManager()
    @State private var hoveredIndex: Int? = nil
    @State private var hasAppeared: Bool = false
    
    var body: some View {
        VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
            .overlay {
                VStack(spacing: 0) {
                    headerView
                    
                    ScrollView {
                        gridView
                            .padding(.horizontal, 16)
                            .padding(.bottom, 16)
                    }
                }
            }
            .frame(width: 520, height: 400)
            .onAppear {
                hasAppeared = true
            }
    }
    
    private var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Clipboard History")
                    .font(.system(size: 18, weight: .semibold, design: .default))
                    .foregroundStyle(.primary)
                
                Text("Recent items")
                    .font(.system(size: 11, weight: .regular, design: .default))
                    .foregroundStyle(.secondary)
            }
            
            Spacer()
            
            HStack(spacing: 4) {
                Circle()
                    .fill(Color.accentColor)
                    .frame(width: 6, height: 6)
                
                Text("\(clipboardManager.items.count) of 8")
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 16)
    }
    
    private var gridView: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: 2),
            spacing: 16
        ) {
            ForEach(Array(clipboardManager.items.enumerated()), id: \.element.id) { index, item in
                ItemCardView(
                    item: item,
                    isHovered: hoveredIndex == index,
                    animationDelay: hasAppeared ? Double(index) * 0.1 : 0
                )
                .onTapGesture {
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                        clipboardManager.accessItem(at: index)
                    }
                }
                .onHover { isHovering in
                    withAnimation(.easeInOut(duration: 0.2)) {
                        hoveredIndex = isHovering ? index : nil
                    }
                }
            }
            
            ForEach(clipboardManager.items.count..<8, id: \.self) { index in
                EmptySlotView(animationDelay: hasAppeared ? Double(index) * 0.1 : 0)
            }
        }
    }
}

struct ItemCardView: View {
    let item: ClipboardItem
    let isHovered: Bool
    let animationDelay: Double
    
    @State private var hasAnimated: Bool = false
    
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                typeIcon
                    .foregroundStyle(.secondary)
                    .font(.system(size: 16, weight: .medium, design: .default))
                
                Spacer()
                
                if item.isDecayed {
                    Image(systemName: "clock")
                        .font(.system(size: 10, weight: .medium, design: .default))
                        .foregroundStyle(.secondary)
                }
            }
            
            Text(item.content)
                .font(.system(size: 13, weight: .regular, design: .default))
                .foregroundStyle(.primary)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background {
            RoundedRectangle(cornerRadius: 8)
                .fill(.regularMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(isHovered ? Color.accentColor : Color.clear, lineWidth: 1)
                }
        }
        .scaleEffect(hasAnimated ? 1.0 : 0.9)
        .opacity(hasAnimated ? 1.0 : 0.0)
        .animation(.spring(response: 0.6, dampingFraction: 0.8).delay(animationDelay), value: hasAnimated)
        .onAppear {
            hasAnimated = true
        }
    }
    
    private var typeIcon: some View {
        switch item.type {
        case .text:
            return Image(systemName: "doc.text")
        case .url:
            return Image(systemName: "link")
        case .image:
            return Image(systemName: "photo")
        }
    }
}

struct EmptySlotView: View {
    let animationDelay: Double
    @State private var hasAnimated: Bool = false
    
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(.clear)
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.secondary.opacity(0.3), lineWidth: 1)
                    .background(.clear)
            }
            .frame(height: 80)
            .scaleEffect(hasAnimated ? 1.0 : 0.9)
            .opacity(hasAnimated ? 1.0 : 0.0)
            .animation(.spring(response: 0.6, dampingFraction: 0.8).delay(animationDelay), value: hasAnimated)
            .onAppear {
                hasAnimated = true
            }
    }
}

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let effectView = NSVisualEffectView()
        effectView.material = material
        effectView.blendingMode = blendingMode
        effectView.state = .active
        return effectView
    }
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}