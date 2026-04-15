struct ContentView: View {
    @StateObject private var store: ShelfStore = ShelfStore()
    @State private var hoveredSlot: Int? = nil
    @State private var hasLaunched: Bool = false
    @State private var draggedItem: ShelfItem? = nil
    
    private let maxSlots: Int = 8
    private let slotWidth: CGFloat = 140
    private let slotHeight: CGFloat = 100
    private let slotSpacing: CGFloat = 12
    
    // Simplified color palette
    private var primaryColor: Color { .primary }
    private var secondaryColor: Color { .secondary }
    private var accentColor: Color { .accentColor }
    private var separatorColor: Color { .separator }
    
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: slotSpacing) {
                ForEach(0..<maxSlots, id: \.self) { index in
                    slotView(for: index)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .frame(width: CGFloat(maxSlots) * (slotWidth + slotSpacing) + 40 - slotSpacing)
        .onAppear {
            withAnimation(.easeOut(duration: 0.8)) {
                hasLaunched = true
            }
        }
    }
    
    @ViewBuilder
    private func slotView(for index: Int) -> some View {
        let item = store.items[index]
        let isHovered = hoveredSlot == index
        let isDragTarget = draggedItem != nil && item == nil
        
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(.thickMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(
                            isDragTarget ? accentColor : separatorColor, 
                            lineWidth: 1
                        )
                )
            
            if let item = item {
                itemContentView(item: item, isHovered: isHovered)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                emptySlotView(isHovered: isHovered, isDragTarget: isDragTarget)
            }
        }
        .frame(width: slotWidth, height: slotHeight)
        .scaleEffect(isHovered ? 1.05 : 1.0)
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: isHovered)
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: isDragTarget)
        .onHover { hovering in
            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                hoveredSlot = hovering ? index : nil
            }
        }
        .onDrop(of: ["public.text", "public.url", "public.file-url"], isTargeted: nil) { providers in
            handleDrop(providers: providers, at: index)
        }
    }
    
    @ViewBuilder
    private func itemContentView(item: ShelfItem, isHovered: Bool) -> some View {
        ZStack {
            LinearGradient(
                colors: [
                    item.type.backgroundColor,
                    item.type.backgroundColor
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            
            VStack(spacing: 8) {
                Spacer()
                
                Text(contentPreview(for: item))
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(primaryColor)
                    .lineLimit(3)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 12)
                
                Spacer()
                
                if isHovered {
                    Text("\(item.content.count) characters")
                        .font(.caption)
                        .foregroundStyle(secondaryColor)
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.2), value: isHovered)
            
            VStack {
                Spacer()
                HStack {
                    typeBadge(for: item.type)
                    Spacer()
                }
            }
            .padding(10)
        }
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .draggable(item.content) {
            draggedItem = item
        }
        .contextMenu {
            Button("Copy Content") {
                NSPasteboard.general.setString(item.content, forType: .string)
            }
            Button("Edit Content") {
                // Future implementation
            }
            Divider()
            Button("Remove", role: .destructive) {
                withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                    store.removeItem(at: store.items.firstIndex { $0?.id == item.id } ?? 0)
                }
            }
        }
    }
    
    @ViewBuilder
    private func emptySlotView(isHovered: Bool, isDragTarget: Bool) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(
                    isDragTarget ? accentColor : separatorColor,
                    style: isDragTarget ? .init(lineWidth: 2, dash: [5, 3]) : .init()
                )
            
            VStack(spacing: 6) {
                Image(systemName: "plus.circle")
                    .font(.title2)
                    .foregroundStyle(secondaryColor)
                
                Text("Drop here")
                    .font(.caption)
                    .foregroundStyle(secondaryColor)
            }
        }
    }
    
    @ViewBuilder
    private func typeBadge(for type: ContentType) -> some View {
        Circle()
            .fill(type.backgroundColor)
            .frame(width: 16, height: 16)
            .overlay(
                Image(systemName: type.iconName)
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(.white)
            )
    }
    
    private func contentPreview(for item: ShelfItem) -> String {
        let content = item.content.trimmingCharacters(in: .whitespacesAndNewlines)
        return String(content.prefix(100))
    }
    
    private func handleDrop(providers: [NSItemProvider], at index: Int) -> Bool {
        guard let provider = providers.first else { return false }
        
        if provider.canLoadObject(ofClass: String.self) {
            provider.loadObject(ofClass: String.self) { string, error in
                DispatchQueue.main.async {
                    if let content = string {
                        let item = ShelfItem(content: content, type: determineContentType(content))
                        withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                            store.addItem(item, at: index)
                        }
                    }
                }
            }
            return true
        }
        
        return false
    }
    
    private func determineContentType(_ content: String) -> ContentType {
        if content.hasPrefix("http://") || content.hasPrefix("https://") {
            return .url
        } else if content.contains("@") && content.contains(".") {
            return .email
        } else if content.rangeOfCharacter(from: CharacterSet.decimalDigits.inverted) == nil {
            return .phone
        } else {
            return .text
        }
    }
}

struct ShelfStore: ObservableObject {
    @Published var items: [ShelfItem?] = Array(repeating: nil, count: 8)
    
    func addItem(_ item: ShelfItem, at index: Int) {
        guard index < items.count else { return }
        items[index] = item
    }
    
    func removeItem(at index: Int) {
        guard index < items.count else { return }
        items[index] = nil
    }
}

struct ShelfItem: Identifiable, Equatable {
    let id = UUID()
    let content: String
    let type: ContentType
    let createdAt = Date()
    
    static func == (lhs: ShelfItem, rhs: ShelfItem) -> Bool {
        lhs.id == rhs.id
    }
}

enum ContentType: CaseIterable {
    case text, url, email, phone
    
    var backgroundColor: Color {
        switch self {
        case .text: return .blue
        case .url: return .green
        case .email: return .orange
        case .phone: return .purple
        }
    }
    
    var iconName: String {
        switch self {
        case .text: return "text.alignleft"
        case .url: return "link"
        case .email: return "envelope"
        case .phone: return "phone"
        }
    }
}