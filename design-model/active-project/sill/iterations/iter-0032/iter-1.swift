struct ContentView: View {
    @StateObject private var clipboardManager = ClipboardManager()
    @State private var hoveredIndex: Int? = nil
    
    var body: some View {
        VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
            .overlay {
                VStack(spacing: 0) {
                    HStack {
                        Text("Clipboard History")
                            .font(.system(.headline, design: .default))
                            .foregroundStyle(.primary)
                        
                        Spacer()
                        
                        Text("\(clipboardManager.items.count) of 8")
                            .font(.system(.subheadline, design: .default))
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 20)
                    .padding(.bottom, 16)
                    
                    ScrollView {
                        LazyVGrid(
                            columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: 2),
                            spacing: 16
                        ) {
                            ForEach(Array(clipboardManager.items.enumerated()), id: \.element.id) { index, item in
                                ItemCardView(
                                    item: item,
                                    isHovered: hoveredIndex == index
                                )
                                .onTapGesture {
                                    withAnimation(.easeInOut(duration: 0.1)) {
                                        clipboardManager.accessItem(at: index)
                                    }
                                }
                                .onHover { isHovering in
                                    hoveredIndex = isHovering ? index : nil
                                }
                            }
                            
                            ForEach(clipboardManager.items.count..<8, id: \.self) { _ in
                                EmptySlotView()
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 20)
                    }
                }
            }
            .frame(width: 480, height: 360)
    }
}

struct ItemCardView: View {
    let item: ClipboardItem
    let isHovered: Bool
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                typeIcon
                    .foregroundStyle(.secondary)
                
                Spacer()
                
                if item.isDecayed {
                    Image(systemName: "clock")
                        .font(.system(.caption2, weight: .medium))
                        .foregroundStyle(.tertiary)
                }
            }
            
            Text(item.content)
                .font(.system(.body, design: .default))
                .foregroundStyle(.primary)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            
            Text(RelativeDateTimeFormatter().localizedString(for: item.timestamp, relativeTo: Date()))
                .font(.system(.caption, design: .default))
                .foregroundStyle(.tertiary)
        }
        .padding(12)
        .frame(height: 120)
        .background {
            RoundedRectangle(cornerRadius: 8)
                .fill(.regularMaterial)
        }
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(isHovered ? Color.accentColor.opacity(0.5) : Color.clear, lineWidth: 1)
        }
        .scaleEffect(isHovered ? 1.02 : 1.0)
        .animation(.easeInOut(duration: 0.15), value: isHovered)
    }
    
    @ViewBuilder
    private var typeIcon: some View {
        switch item.type {
        case .text:
            Image(systemName: "doc.text")
        case .image:
            Image(systemName: "photo")
        case .url:
            Image(systemName: "link")
        case .file:
            Image(systemName: "doc")
        }
    }
}

struct EmptySlotView: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(.ultraThinMaterial)
            .frame(height: 120)
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(.tertiary.opacity(0.5), lineWidth: 1, antialiased: true)
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
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}