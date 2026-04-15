struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(title: "Design System.sketch", addedAt: Date().addingTimeInterval(-3600), contentType: .file, preview: "doc.text"),
        ShelfItem(title: "Meeting Notes", addedAt: Date().addingTimeInterval(-86400), contentType: .text, preview: "Key decisions from quarterly planning session"),
        ShelfItem(title: "Sunset.jpg", addedAt: Date().addingTimeInterval(-172800), contentType: .image, preview: "photo"),
        ShelfItem(title: "API Documentation", addedAt: Date().addingTimeInterval(-259200), contentType: .text, preview: "REST endpoints for user management"),
        ShelfItem(title: "Prototype.fig", addedAt: Date().addingTimeInterval(-432000), contentType: .file, preview: "paintbrush"),
        ShelfItem(title: "Old Script", addedAt: Date().addingTimeInterval(-518400), contentType: .file, preview: "applescript")
    ]
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
                .ignoresSafeArea()
            
            HStack(spacing: 16) {
                ForEach(items.prefix(8)) { item in
                    ShelfSlotView(item: item)
                }
                
                ForEach(0..<max(0, 8 - items.count), id: \.self) { _ in
                    EmptySlotView()
                }
            }
            .padding(24)
        }
        .frame(minWidth: 900, minHeight: 220)
    }
}

struct ShelfSlotView: View {
    let item: ShelfItem
    @State private var isHovered = false
    @State private var showDetails = false
    
    private var ageInDays: Double {
        Date().timeIntervalSince(item.addedAt) / 86400
    }
    
    private var isRecent: Bool {
        ageInDays < 1
    }
    
    private var slotWidth: CGFloat {
        switch item.contentType {
        case .text:
            return 140
        case .image:
            return 100
        case .file:
            return 110
        }
    }
    
    var body: some View {
        VStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.regularMaterial)
                    .frame(width: slotWidth, height: 90)
                    .shadow(color: .black.opacity(0.1), radius: 2, x: 0, y: 1)
                    .shadow(color: .black.opacity(isHovered ? 0.15 : 0.05), radius: isHovered ? 8 : 4, x: 0, y: isHovered ? 4 : 2)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(.tertiary.opacity(0.5), lineWidth: 1)
                    )
                
                Group {
                    if item.contentType == .text {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Image(systemName: "text.alignleft")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundColor(.secondary)
                                Spacer()
                            }
                            Text(item.preview)
                                .font(.system(.caption2, design: .default))
                                .foregroundColor(.secondary)
                                .lineLimit(3)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(10)
                    } else {
                        Image(systemName: item.preview)
                            .font(.system(size: 28, weight: .regular))
                            .foregroundColor(.primary)
                    }
                }
                
                if isRecent {
                    VStack {
                        HStack {
                            Spacer()
                            Circle()
                                .fill(.accent)
                                .frame(width: 6, height: 6)
                                .padding(.trailing, 8)
                                .padding(.top, 8)
                        }
                        Spacer()
                    }
                }
            }
            .scaleEffect(isHovered ? 1.02 : 1.0)
            
            Text(item.title)
                .font(.system(.caption, design: .default, weight: .medium))
                .foregroundColor(.primary)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .frame(width: slotWidth)
        }
        .onHover { hovering in
            withAnimation(.spring(response: 0.25, dampingFraction: 0.7)) {
                isHovered = hovering
            }
        }
        .onTapGesture {
            showDetails.toggle()
        }
        .popover(isPresented: $showDetails) {
            ItemDetailView(item: item)
        }
    }
}

struct EmptySlotView: View {
    var body: some View {
        VStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 12)
                .fill(.regularMaterial.opacity(0.5))
                .frame(width: 110, height: 90)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [6, 6]))
                        .foregroundColor(.tertiary)
                )
            
            Text("")
                .font(.system(.caption, weight: .medium))
                .frame(width: 110, height: 32)
        }
    }
}

struct ItemDetailView: View {
    let item: ShelfItem
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: item.preview)
                    .foregroundColor(.accent)
                    .font(.title2)
                Text(item.title)
                    .font(.headline)
                    .fontWeight(.semibold)
            }
            
            Text("Added: \(item.addedAt.formatted(date: .abbreviated, time: .shortened))")
                .font(.caption)
                .foregroundColor(.secondary)
            
            if item.contentType == .text {
                Text(item.preview)
                    .font(.body)
                    .foregroundColor(.primary)
            }
        }
        .padding(16)
        .frame(minWidth: 220, maxWidth: 320)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
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