struct ContentView: View {
    @State private var shelfItems: [ShelfItem] = [
        ShelfItem(name: "Notes", type: .document, preview: "Meeting notes from today's standup", daysOld: 2),
        ShelfItem(name: "Design", type: .image, preview: "Wireframes and mockups for v2.0", daysOld: 1),
        ShelfItem(name: "Code", type: .code, preview: "SwiftUI components library", daysOld: 0),
        ShelfItem(name: "Brief", type: .pdf, preview: "Project requirements document", daysOld: 5),
        ShelfItem(name: "Demo", type: .video, preview: "Screen recording of new flow", daysOld: 6),
        ShelfItem(isEmpty: true),
        ShelfItem(isEmpty: true),
        ShelfItem(isEmpty: true)
    ]
    
    @State private var dragOffset = CGSize.zero
    @State private var selectedIndex: Int? = nil
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
                .ignoresSafeArea()
            
            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Workspace Shelf")
                            .font(.system(size: 28, weight: .bold, design: .default))
                            .foregroundStyle(.primary)
                        
                        Text("Recent files and quick access")
                            .font(.system(size: 15, weight: .medium, design: .default))
                            .foregroundStyle(.secondary)
                    }
                    
                    Spacer()
                    
                    Button(action: {}) {
                        Image(systemName: "plus")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 32, height: 32)
                            .background(.quaternary, in: Circle())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 40)
                .padding(.top, 60)
                
                Spacer()
                
                VStack(spacing: 24) {
                    HStack(spacing: 20) {
                        ForEach(Array(shelfItems.enumerated()), id: \.element.id) { index, item in
                            ShelfSlot(
                                item: item,
                                slotIndex: index,
                                isSelected: selectedIndex == index,
                                onTap: { selectedIndex = selectedIndex == index ? nil : index }
                            )
                        }
                    }
                    .padding(.horizontal, 32)
                    .padding(.vertical, 24)
                    .background {
                        RoundedRectangle(cornerRadius: 20)
                            .fill(.regularMaterial)
                            .stroke(.tertiary, lineWidth: 0.5)
                    }
                    .shadow(color: .black.opacity(0.1), radius: 20, x: 0, y: 10)
                    
                    if let selectedIndex = selectedIndex, !shelfItems[selectedIndex].isEmpty {
                        ItemDetailView(item: shelfItems[selectedIndex])
                            .transition(.asymmetric(
                                insertion: .scale(scale: 0.8).combined(with: .opacity),
                                removal: .scale(scale: 0.8).combined(with: .opacity)
                            ))
                    }
                }
                
                Spacer()
                    .frame(height: 80)
            }
        }
        .frame(width: 1440, height: 900)
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: selectedIndex)
    }
}

struct ShelfSlot: View {
    let item: ShelfItem
    let slotIndex: Int
    let isSelected: Bool
    let onTap: () -> Void
    
    @State private var isHovered = false
    @State private var dragOffset = CGSize.zero
    
    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(item.isEmpty ? .quaternary : item.type.accentColor.opacity(0.1))
                        .stroke(item.isEmpty ? .tertiary : item.type.accentColor.opacity(0.3), lineWidth: 1)
                        .frame(width: 80, height: 80)
                    
                    if !item.isEmpty {
                        Image(systemName: item.type.iconName)
                            .font(.system(size: 28, weight: .medium))
                            .foregroundStyle(item.type.accentColor)
                        
                        if item.daysOld == 0 {
                            Circle()
                                .fill(.green)
                                .frame(width: 8, height: 8)
                                .offset(x: 30, y: -30)
                        }
                    } else {
                        Image(systemName: "plus")
                            .font(.system(size: 20, weight: .medium))
                            .foregroundStyle(.tertiary)
                    }
                }
                .scaleEffect(isHovered ? 1.05 : 1.0)
                .scaleEffect(isSelected ? 1.1 : 1.0)
                
                if !item.isEmpty {
                    Text(item.name)
                        .font(.system(size: 13, weight: .semibold, design: .default))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                } else {
                    Text("Empty")
                        .font(.system(size: 13, weight: .medium, design: .default))
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.2)) {
                isHovered = hovering
            }
        }
        .offset(dragOffset)
        .gesture(
            DragGesture()
                .onChanged { value in
                    dragOffset = value.translation
                }
                .onEnded { _ in
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) {
                        dragOffset = .zero
                    }
                }
        )
    }
}

struct ItemDetailView: View {
    let item: ShelfItem
    
    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: item.type.iconName)
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(item.type.accentColor)
                .frame(width: 48, height: 48)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
            
            VStack(alignment: .leading, spacing: 4) {
                Text(item.name)
                    .font(.system(size: 17, weight: .semibold, design: .default))
                    .foregroundStyle(.primary)
                
                Text(item.preview)
                    .font(.system(size: 14, weight: .regular, design: .default))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                
                Text(timeAgoText)
                    .font(.system(size: 12, weight: .medium, design: .default))
                    .foregroundStyle(.tertiary)
            }
            
            Spacer()
            
            HStack(spacing: 12) {
                Button("Open") {
                    
                }
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .frame(height: 32)
                .padding(.horizontal, 16)
                .background(item.type.accentColor, in: RoundedRectangle(cornerRadius: 8))
                .buttonStyle(.plain)
                
                Button("Show in Finder") {
                    
                }
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(height: 32)
                .padding(.horizontal, 16)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                .buttonStyle(.plain)
            }
        }
        .padding(20)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(.tertiary, lineWidth: 0.5)
        )
    }
    
    private var timeAgoText: String {
        switch item.daysOld {
        case 0: return "Today"
        case 1: return "Yesterday"
        default: return "\(item.daysOld) days ago"
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
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}