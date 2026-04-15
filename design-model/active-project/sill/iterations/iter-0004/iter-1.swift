struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(title: "Design System.sketch", addedAt: Date().addingTimeInterval(-3600), contentType: .file, preview: "doc.text"),
        ShelfItem(title: "Meeting Notes", addedAt: Date().addingTimeInterval(-86400), contentType: .text, preview: "Key decisions from..."),
        ShelfItem(title: "Sunset.jpg", addedAt: Date().addingTimeInterval(-172800), contentType: .image, preview: "photo"),
        ShelfItem(title: "API Documentation", addedAt: Date().addingTimeInterval(-259200), contentType: .text, preview: "REST endpoints..."),
        ShelfItem(title: "Prototype.fig", addedAt: Date().addingTimeInterval(-432000), contentType: .file, preview: "paintbrush"),
        ShelfItem(title: "Old Script", addedAt: Date().addingTimeInterval(-518400), contentType: .file, preview: "#!/bin/bash")
    ]
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .hudWindow, blendingMode: .behindWindow)
                .ignoresSafeArea()
            
            HStack(spacing: 12) {
                ForEach(items.prefix(8)) { item in
                    ShelfSlotView(item: item)
                }
                
                ForEach(0..<max(0, 8 - items.count), id: \.self) { _ in
                    EmptySlotView()
                }
            }
            .padding()
        }
        .frame(minWidth: 800, minHeight: 200)
    }
}

struct ShelfSlotView: View {
    let item: ShelfItem
    @State private var isHovered = false
    @State private var showDetails = false
    
    private var ageInDays: Double {
        Date().timeIntervalSince(item.addedAt) / 86400
    }
    
    private var accentColor: Color {
        if ageInDays < 1 {
            return .accentColor
        } else if ageInDays < 3 {
            return .secondary
        } else {
            return Color(NSColor.tertiaryLabelColor)
        }
    }
    
    private var opacity: Double {
        if ageInDays >= 6 {
            return 0.4
        } else if ageInDays >= 3 {
            return 0.7
        }
        return 1.0
    }
    
    private var shouldPulse: Bool {
        ageInDays < 1
    }
    
    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color(NSColor.controlBackgroundColor))
                    .frame(width: 120, height: 80)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(accentColor.opacity(shouldPulse ? 1.0 : 0.3), lineWidth: shouldPulse ? 2 : 1)
                    )
                
                Group {
                    if item.contentType == .text {
                        Text(item.preview)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundColor(.secondary)
                            .lineLimit(4)
                            .padding(8)
                    } else {
                        Image(systemName: item.preview)
                            .font(.system(size: 24, weight: .regular))
                            .foregroundColor(accentColor)
                    }
                }
            }
            .scaleEffect(isHovered ? 1.05 : 1.0)
            
            Text(item.title)
                .font(.system(.caption, design: .default, weight: .medium))
                .foregroundColor(.primary)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .frame(width: 120)
        }
        .opacity(opacity)
        .onHover { hovering in
            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                isHovered = hovering
            }
        }
        .onTapGesture {
            showDetails.toggle()
        }
        .popover(isPresented: $showDetails) {
            ItemDetailView(item: item)
        }
        .animation(shouldPulse ? .easeInOut(duration: 2.0).repeatForever(autoreverses: true) : .default, value: shouldPulse)
    }
}

struct EmptySlotView: View {
    var body: some View {
        VStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(NSColor.controlBackgroundColor).opacity(0.3))
                .frame(width: 120, height: 80)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                        .foregroundColor(Color(NSColor.tertiaryLabelColor))
                )
            
            Text("")
                .font(.system(.caption, weight: .medium))
                .frame(width: 120, height: 32)
        }
    }
}

struct ItemDetailView: View {
    let item: ShelfItem
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: item.preview)
                    .foregroundColor(.accentColor)
                Text(item.title)
                    .font(.headline)
                    .fontDesign(.default)
            }
            
            Text("Added: \(item.addedAt.formatted(date: .abbreviated, time: .shortened))")
                .font(.caption)
                .foregroundColor(.secondary)
            
            if item.contentType == .text {
                Text(item.preview)
                    .font(.body)
                    .fontDesign(.monospaced)
            }
        }
        .padding()
        .frame(minWidth: 200, maxWidth: 300)
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