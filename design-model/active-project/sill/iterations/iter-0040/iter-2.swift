struct ContentView: View {
    @StateObject private var clipboardManager = ClipboardManager()
    @State private var hoveredIndex: Int? = nil
    
    var body: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(.regularMaterial)
                .frame(height: 32)
                .overlay(
                    HStack {
                        Image(systemName: "clipboard")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.secondary)
                        Text("Clipboard Shelf")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(.primary)
                        Spacer()
                        Text("\(clipboardManager.items.count)/6")
                            .font(.system(size: 11, weight: .regular))
                            .foregroundColor(.secondary)
                    }
                    .padding(.horizontal, 16),
                    alignment: .center
                )
            
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(clipboardManager.items.prefix(6).enumerated()), id: \.element.id) { index, item in
                        ClipboardSlot(
                            item: item,
                            isSelected: clipboardManager.selectedItem?.id == item.id,
                            isHovered: hoveredIndex == index,
                            onSelect: { item in
                                withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                                    clipboardManager.selectItem(item)
                                }
                            },
                            onHover: { hovering in
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    hoveredIndex = hovering ? index : nil
                                }
                            }
                        )
                    }
                    
                    ForEach(0..<max(0, 6 - clipboardManager.items.count), id: \.self) { index in
                        EmptySlot(index: clipboardManager.items.count + index)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 16)
            }
            .background(.thickMaterial)
        }
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(.separator, lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.1), radius: 8, x: 0, y: 4)
        .frame(width: 480, height: 140)
    }
}

struct ClipboardSlot: View {
    let item: ClipboardItem
    let isSelected: Bool
    let isHovered: Bool
    let onSelect: (ClipboardItem) -> Void
    let onHover: (Bool) -> Void
    @State private var isPressed = false
    
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(backgroundMaterial)
            .overlay(
                VStack(spacing: 6) {
                    HStack {
                        Image(systemName: iconName(for: item.type))
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(iconColor)
                        Spacer()
                        if isSelected {
                            Circle()
                                .fill(.blue)
                                .frame(width: 6, height: 6)
                        }
                    }
                    
                    Spacer()
                    
                    VStack(spacing: 2) {
                        Text(item.displayText)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.primary)
                            .lineLimit(3)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        
                        Text(timeAgo(from: item.timestamp))
                            .font(.system(size: 9, weight: .regular))
                            .foregroundColor(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(8)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(strokeColor, lineWidth: strokeWidth)
            )
            .scaleEffect(isPressed ? 0.95 : (isHovered ? 1.02 : 1.0))
            .shadow(color: shadowColor, radius: shadowRadius, x: 0, y: shadowOffset)
            .frame(width: 68, height: 88)
            .onHover { hovering in
                onHover(hovering)
            }
            .onTapGesture {
                withAnimation(.spring(response: 0.2, dampingFraction: 0.8)) {
                    isPressed = true
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    withAnimation(.spring(response: 0.2, dampingFraction: 0.8)) {
                        isPressed = false
                    }
                }
                onSelect(item)
            }
            .animation(.spring(response: 0.4, dampingFraction: 0.8), value: isHovered)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isSelected)
    }
    
    private var backgroundMaterial: some ShapeStyle {
        if isSelected {
            return AnyShapeStyle(.blue.opacity(0.1))
        } else if isHovered {
            return AnyShapeStyle(.regularMaterial)
        } else {
            return AnyShapeStyle(.thinMaterial)
        }
    }
    
    private var iconColor: Color {
        isSelected ? .blue : .accentColor
    }
    
    private var strokeColor: Color {
        if isSelected {
            return .blue.opacity(0.6)
        } else if isHovered {
            return .separator.opacity(0.8)
        } else {
            return .separator.opacity(0.3)
        }
    }
    
    private var strokeWidth: CGFloat {
        isSelected ? 1.5 : 0.5
    }
    
    private var shadowColor: Color {
        if isSelected {
            return .blue.opacity(0.2)
        } else if isHovered {
            return .black.opacity(0.1)
        } else {
            return .clear
        }
    }
    
    private var shadowRadius: CGFloat {
        isHovered || isSelected ? 4 : 0
    }
    
    private var shadowOffset: CGFloat {
        isHovered || isSelected ? 2 : 0
    }
    
    private func iconName(for type: ClipboardItem.ClipboardType) -> String {
        switch type {
        case .text: return "doc.text.fill"
        case .file: return "doc.fill"
        case .url: return "link"
        }
    }
    
    private func timeAgo(from date: Date) -> String {
        let interval = Date().timeIntervalSince(date)
        if interval < 60 {
            return "now"
        } else if interval < 3600 {
            return "\(Int(interval/60))m"
        } else {
            return "\(Int(interval/3600))h"
        }
    }
}

struct EmptySlot: View {
    let index: Int
    @State private var isHovered = false
    
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(.ultraThinMaterial)
            .overlay(
                VStack(spacing: 4) {
                    Image(systemName: "plus.circle")
                        .font(.system(size: 16, weight: .light))
                        .foregroundColor(.secondary.opacity(0.6))
                    
                    Text("Empty")
                        .font(.system(size: 10, weight: .regular))
                        .foregroundColor(.secondary.opacity(0.6))
                }
                .opacity(isHovered ? 1.0 : 0.4)
                .animation(.easeInOut(duration: 0.2), value: isHovered)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(.separator.opacity(0.2), lineWidth: 1)
                    .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
            )
            .frame(width: 68, height: 88)
            .onHover { hovering in
                isHovered = hovering
            }
    }
}