struct ContentView: View {
    @StateObject private var clipboardManager = ClipboardManager()
    @State private var hoveredIndex: Int? = nil
    @State private var animationOffset: CGFloat = 0
    
    var body: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(
                    LinearGradient(
                        gradient: Gradient(colors: [
                            .primary.opacity(0.03),
                            .primary.opacity(0.08)
                        ]),
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(height: 36)
                .overlay(
                    HStack {
                        Image(systemName: "clipboard.fill")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(
                                LinearGradient(
                                    colors: [.blue, .purple],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                        Text("Clipboard Shelf")
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                            .foregroundColor(.primary)
                        Spacer()
                        HStack(spacing: 4) {
                            Circle()
                                .fill(.green)
                                .frame(width: 6, height: 6)
                            Text("\(clipboardManager.items.count)/6")
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.horizontal, 20),
                    alignment: .center
                )
            
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(Array(clipboardManager.items.prefix(6).enumerated()), id: \.element.id) { index, item in
                        ClipboardSlot(
                            item: item,
                            isSelected: clipboardManager.selectedItem?.id == item.id,
                            isHovered: hoveredIndex == index,
                            index: index,
                            onSelect: { item in
                                withAnimation(.interpolatingSpring(stiffness: 300, damping: 20)) {
                                    clipboardManager.selectItem(item)
                                }
                            },
                            onHover: { hovering in
                                withAnimation(.interpolatingSpring(stiffness: 400, damping: 25)) {
                                    hoveredIndex = hovering ? index : nil
                                }
                            }
                        )
                        .scaleEffect(
                            hoveredIndex == index ? 1.05 : 
                            (clipboardManager.selectedItem?.id == item.id ? 1.02 : 1.0)
                        )
                        .rotationEffect(.degrees(hoveredIndex == index ? Double.random(in: -1...1) : 0))
                        .animation(.interpolatingSpring(stiffness: 300, damping: 20).delay(Double(index) * 0.05), value: hoveredIndex)
                    }
                    
                    ForEach(0..<max(0, 6 - clipboardManager.items.count), id: \.self) { index in
                        EmptySlot(index: clipboardManager.items.count + index)
                            .scaleEffect(hoveredIndex == (clipboardManager.items.count + index) ? 1.05 : 1.0)
                            .animation(.interpolatingSpring(stiffness: 300, damping: 20), value: hoveredIndex)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 18)
                .offset(x: animationOffset)
                .onAppear {
                    withAnimation(.easeOut(duration: 0.6)) {
                        animationOffset = 0
                    }
                }
            }
            .background(
                LinearGradient(
                    gradient: Gradient(colors: [
                        .primary.opacity(0.02),
                        .primary.opacity(0.06)
                    ]),
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(
                    LinearGradient(
                        colors: [.white.opacity(0.3), .clear],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    lineWidth: 1
                )
        )
        .shadow(color: .black.opacity(0.15), radius: 12, x: 0, y: 6)
        .shadow(color: .black.opacity(0.05), radius: 2, x: 0, y: 1)
        .frame(width: 520, height: 150)
    }
}

struct ClipboardSlot: View {
    let item: ClipboardItem
    let isSelected: Bool
    let isHovered: Bool
    let index: Int
    let onSelect: (ClipboardItem) -> Void
    let onHover: (Bool) -> Void
    @State private var isPressed = false
    
    var body: some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(backgroundGradient)
            .overlay(
                VStack(spacing: 8) {
                    HStack {
                        ZStack {
                            Circle()
                                .fill(iconBackgroundGradient)
                                .frame(width: 24, height: 24)
                            Image(systemName: iconName(for: item.type))
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(.white)
                        }
                        Spacer()
                        if isSelected {
                            ZStack {
                                Circle()
                                    .fill(.blue)
                                    .frame(width: 10, height: 10)
                                Circle()
                                    .fill(.white)
                                    .frame(width: 4, height: 4)
                            }
                            .scaleEffect(isSelected ? 1.0 : 0.5)
                            .animation(.interpolatingSpring(stiffness: 400, damping: 15), value: isSelected)
                        }
                    }
                    
                    Spacer()
                    
                    VStack(spacing: 4) {
                        Text(item.displayText)
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .foregroundColor(.primary)
                            .lineLimit(3)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        
                        Text(timeAgo(from: item.timestamp))
                            .font(.system(size: 9, weight: .medium, design: .rounded))
                            .foregroundColor(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(12)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(strokeGradient, lineWidth: strokeWidth)
            )
            .scaleEffect(isPressed ? 0.92 : 1.0)
            .frame(width: 76, height: 96)
            .onHover { hovering in
                onHover(hovering)
            }
            .onTapGesture {
                withAnimation(.interpolatingSpring(stiffness: 600, damping: 20)) {
                    isPressed = true
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
                    withAnimation(.interpolatingSpring(stiffness: 400, damping: 20)) {
                        isPressed = false
                    }
                }
                onSelect(item)
            }
    }
    
    private var backgroundGradient: LinearGradient {
        if isSelected {
            return LinearGradient(
                gradient: Gradient(colors: [
                    .blue.opacity(0.15),
                    .blue.opacity(0.25)
                ]),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        } else if isHovered {
            return LinearGradient(
                gradient: Gradient(colors: [
                    .primary.opacity(0.08),
                    .primary.opacity(0.12)
                ]),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        } else {
            return LinearGradient(
                gradient: Gradient(colors: [
                    .primary.opacity(0.04),
                    .primary.opacity(0.08)
                ]),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }
    
    private var iconBackgroundGradient: LinearGradient {
        switch item.type {
        case .text:
            return LinearGradient(colors: [.blue, .purple], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .url:
            return LinearGradient(colors: [.green, .blue], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .image:
            return LinearGradient(colors: [.orange, .red], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }
    
    private var strokeGradient: LinearGradient {
        if isSelected {
            return LinearGradient(
                colors: [.blue.opacity(0.6), .blue.opacity(0.3)],
                startPoint: .top,
                endPoint: .bottom
            )
        } else if isHovered {
            return LinearGradient(
                colors: [.primary.opacity(0.2), .primary.opacity(0.1)],
                startPoint: .top,
                endPoint: .bottom
            )
        } else {
            return LinearGradient(
                colors: [.primary.opacity(0.1), .primary.opacity(0.05)],
                startPoint: .top,
                endPoint: .bottom
            )
        }
    }
    
    private var strokeWidth: CGFloat {
        isSelected ? 2.0 : (isHovered ? 1.5 : 1.0)
    }
    
    func iconName(for type: ClipboardType) -> String {
        switch type {
        case .text:
            return "textformat"
        case .url:
            return "link"
        case .image:
            return "photo"
        }
    }
    
    func timeAgo(from date: Date) -> String {
        let interval = Date().timeIntervalSince(date)
        let minutes = Int(interval / 60)
        if minutes < 60 {
            return "\(minutes)m ago"
        } else {
            let hours = minutes / 60
            return "\(hours)h ago"
        }
    }
}

struct EmptySlot: View {
    let index: Int
    @State private var isHovered = false
    @State private var pulseAnimation = false
    
    var body: some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(
                LinearGradient(
                    gradient: Gradient(colors: [
                        .primary.opacity(isHovered ? 0.06 : 0.02),
                        .primary.opacity(isHovered ? 0.1 : 0.04)
                    ]),
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                VStack(spacing: 6) {
                    ZStack {
                        Circle()
                            .stroke(
                                LinearGradient(
                                    colors: [.blue.opacity(0.3), .purple.opacity(0.3)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                style: StrokeStyle(lineWidth: 2, dash: [3, 3])
                            )
                            .frame(width: 28, height: 28)
                            .rotationEffect(.degrees(pulseAnimation ? 360 : 0))
                        
                        Image(systemName: "plus")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(
                                LinearGradient(
                                    colors: [.blue.opacity(0.6), .purple.opacity(0.6)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .scaleEffect(pulseAnimation ? 1.1 : 1.0)
                    }
                    
                    Spacer()
                    
                    Text("Empty")
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundColor(.secondary.opacity(0.8))
                }
                .padding(12)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(
                        LinearGradient(
                            colors: [.primary.opacity(isHovered ? 0.15 : 0.08), .primary.opacity(0.04)],
                            startPoint: .top,
                            endPoint: .bottom
                        ),
                        style: StrokeStyle(lineWidth: 1, dash: isHovered ? [] : [4, 4])
                    )
            )
            .frame(width: 76, height: 96)
            .onHover { hovering in
                withAnimation(.interpolatingSpring(stiffness: 300, damping: 20)) {
                    isHovered = hovering
                }
            }
            .onAppear {
                withAnimation(.linear(duration: 8).repeatForever(autoreverses: false)) {
                    pulseAnimation = true
                }
            }
    }
}