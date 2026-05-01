struct ContentView: View {
    @StateObject private var clipboardManager = ClipboardManager()
    @State private var hoveredIndex: Int? = nil
    @State private var hasAppeared = false
    
    var body: some View {
        VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
            .overlay {
                ZStack {
                    LinearGradient(
                        colors: [
                            Color.blue.opacity(0.03),
                            Color.purple.opacity(0.02),
                            Color.clear
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    
                    VStack(spacing: 0) {
                        headerView
                        
                        ScrollView {
                            gridView
                                .padding(.horizontal, 24)
                                .padding(.bottom, 24)
                        }
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
                    .font(.system(.title2, design: .default, weight: .semibold))
                    .foregroundStyle(.primary)
                
                Text("Recent items")
                    .font(.system(.caption, design: .default))
                    .foregroundStyle(.secondary)
            }
            
            Spacer()
            
            HStack(spacing: 4) {
                Circle()
                    .fill(Color.green)
                    .frame(width: 6, height: 6)
                
                Text("\(clipboardManager.items.count) of 8")
                    .font(.system(.subheadline, design: .monospaced, weight: .medium))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 24)
        .padding(.bottom, 20)
    }
    
    private var gridView: some View {
        let recentItems = Array(clipboardManager.items.prefix(2))
        let olderItems = Array(clipboardManager.items.dropFirst(2))
        
        return VStack(spacing: 24) {
            if !recentItems.isEmpty {
                LazyVGrid(
                    columns: [
                        GridItem(.flexible(minimum: 200), spacing: 24)
                    ],
                    spacing: 16
                ) {
                    ForEach(Array(recentItems.enumerated()), id: \.element.id) { index, item in
                        ItemCardView(
                            item: item,
                            isHovered: hoveredIndex == index,
                            isPriority: true,
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
                }
            }
            
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: 24), count: 2),
                spacing: 16
            ) {
                ForEach(Array(olderItems.enumerated()), id: \.element.id) { index, item in
                    let actualIndex = index + recentItems.count
                    ItemCardView(
                        item: item,
                        isHovered: hoveredIndex == actualIndex,
                        isPriority: false,
                        animationDelay: hasAppeared ? Double(actualIndex) * 0.1 + 0.2 : 0
                    )
                    .onTapGesture {
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                            clipboardManager.accessItem(at: actualIndex)
                        }
                    }
                    .onHover { isHovering in
                        withAnimation(.easeInOut(duration: 0.2)) {
                            hoveredIndex = isHovering ? actualIndex : nil
                        }
                    }
                }
                
                ForEach(clipboardManager.items.count..<8, id: \.self) { index in
                    EmptySlotView(animationDelay: hasAppeared ? Double(index) * 0.1 + 0.3 : 0)
                }
            }
        }
    }
}

struct ItemCardView: View {
    let item: ClipboardItem
    let isHovered: Bool
    let isPriority: Bool
    let animationDelay: Double
    
    @State private var hasAnimated = false
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                typeIcon
                    .foregroundStyle(isPriority ? .primary : .secondary)
                    .font(.system(.body, weight: .medium))
                
                Spacer()
                
                HStack(spacing: 6) {
                    if isPriority {
                        Image(systemName: "star.fill")
                            .font(.system(.caption2, weight: .medium))
                            .foregroundStyle(.yellow)
                    }
                    
                    if item.isDecayed {
                        Image(systemName: "clock")
                            .font(.system(.caption2, weight: .medium))
                            .foregroundStyle(.orange)
                    }
                }
            }
            
            VStack(alignment: .leading, spacing: 8) {
                Text(item.content)
                    .font(.system(isPriority ? .body : .callout, design: .default, weight: isPriority ? .medium : .regular))
                    .foregroundStyle(.primary)
                    .lineLimit(isPriority ? 4 : 3)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                
                if item.type == .text && item.content.contains("func") {
                    syntaxHighlight
                }
            }
            
            Spacer()
            
            Text(RelativeDateTimeFormatter().localizedString(for: item.timestamp, relativeTo: Date()))
                .font(.system(.caption, design: .default, weight: .medium))
                .foregroundStyle(.tertiary)
        }
        .padding(isPriority ? 16 : 14)
        .frame(height: isPriority ? 140 : 120)
        .background {
            ZStack {
                RoundedRectangle(cornerRadius: isPriority ? 12 : 10)
                    .fill(.regularMaterial)
                
                if isHovered {
                    RoundedRectangle(cornerRadius: isPriority ? 12 : 10)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color.accentColor.opacity(0.08),
                                    Color.accentColor.opacity(0.04)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                }
            }
        }
        .overlay {
            RoundedRectangle(cornerRadius: isPriority ? 12 : 10)
                .strokeBorder(
                    isHovered ? Color.accentColor.opacity(0.6) : (isPriority ? Color.accentColor.opacity(0.2) : Color.clear),
                    lineWidth: isHovered ? 1.5 : (isPriority ? 1 : 0)
                )
        }
        .scaleEffect(isHovered ? 1.03 : 1.0)
        .shadow(
            color: isHovered ? Color.black.opacity(0.15) : Color.black.opacity(isPriority ? 0.08 : 0.04),
            radius: isHovered ? 12 : (isPriority ? 6 : 3),
            x: 0,
            y: isHovered ? 6 : (isPriority ? 3 : 1)
        )
        .animation(.spring(response: 0.4, dampingFraction: 0.7), value: isHovered)
        .opacity(hasAnimated ? 1 : 0)
        .offset(y: hasAnimated ? 0 : 20)
        .onAppear {
            withAnimation(.spring(response: 0.6, dampingFraction: 0.8).delay(animationDelay)) {
                hasAnimated = true
            }
        }
    }
    
    @ViewBuilder
    private var typeIcon: some View {
        switch item.type {
        case .text:
            Image(systemName: "doc.text.fill")
        case .image:
            Image(systemName: "photo.fill")
        case .url:
            Image(systemName: "link.circle.fill")
        case .file:
            Image(systemName: "doc.fill")
        }
    }
    
    private var syntaxHighlight: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(.red)
                .frame(width: 4, height: 4)
            Circle()
                .fill(.yellow)
                .frame(width: 4, height: 4)
            Circle()
                .fill(.green)
                .frame(width: 4, height: 4)
            
            Text("Swift")
                .font(.system(.caption2, design: .monospaced, weight: .medium))
                .foregroundStyle(.secondary)
                .padding(.leading, 4)
            
            Spacer()
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(Color.secondary.opacity(0.1))
        .cornerRadius(6)
    }
}

struct EmptySlotView: View {
    let animationDelay: Double
    
    @State private var hasAnimated = false
    
    var body: some View {
        RoundedRectangle(cornerRadius: 10)
            .fill(.ultraThinMaterial)
            .frame(height: 120)
            .overlay {
                VStack(spacing: 8) {
                    Image(systemName: "plus.circle")
                        .font(.system(.title3))
                        .foregroundStyle(.tertiary)
                    
                    Text("Empty")
                        .font(.system(.caption2, design: .default, weight: .medium))
                        .foregroundStyle(.quaternary)
                }
            }
            .overlay {
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(.tertiary.opacity(0.3), lineWidth: 1, antialiased: true)
                    .blendMode(.overlay)
            }
            .opacity(hasAnimated ? 1 : 0)
            .scaleEffect(hasAnimated ? 1 : 0.9)
            .onAppear {
                withAnimation(.spring(response: 0.6, dampingFraction: 0.8).delay(animationDelay)) {
                    hasAnimated = true
                }
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