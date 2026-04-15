struct ContentView: View {
    @State private var hoveredSlot: Int? = nil
    @State private var selectedSlot: Int? = nil
    
    private let slotLabels = ["Documents", "Downloads", "Desktop", "Pictures", "Music", "Videos", "Projects", "Archive"]
    
    var body: some View {
        ZStack {
            Color(NSColor.windowBackgroundColor)
                .ignoresSafeArea()
            
            VStack(spacing: 24) {
                Text("Quick Access")
                    .font(.largeTitle)
                    .fontWeight(.medium)
                    .foregroundColor(.primary)
                
                // Main container
                VStack(spacing: 16) {
                    HStack(spacing: 24) {
                        ForEach(0..<4, id: \.self) { index in
                            slotView(for: index)
                        }
                    }
                    
                    HStack(spacing: 24) {
                        ForEach(4..<8, id: \.self) { index in
                            slotView(for: index)
                        }
                    }
                }
                .padding(32)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                .shadow(color: .black.opacity(0.1), radius: 8, x: 0, y: 2)
            }
        }
        .frame(width: 1440, height: 900)
    }
    
    private func slotView(for index: Int) -> some View {
        let isHovered = hoveredSlot == index
        let isSelected = selectedSlot == index
        
        return VStack(spacing: 8) {
            ZStack {
                Circle()
                    .fill(.thickMaterial)
                    .frame(width: 80, height: 80)
                    .overlay(
                        Circle()
                            .strokeBorder(.separator.opacity(0.5), lineWidth: 0.5)
                    )
                    .shadow(color: .black.opacity(0.1), radius: 2, x: 0, y: 1)
                    .scaleEffect(isSelected ? 1.05 : (isHovered ? 1.02 : 1.0))
                
                Image(systemName: systemIconName(for: index))
                    .font(.system(size: 28, weight: .medium))
                    .foregroundColor(isSelected ? .accentColor : .secondary)
                    .symbolEffect(.bounce, value: isSelected)
            }
            
            Text(slotLabels[index])
                .font(.caption)
                .fontWeight(.medium)
                .foregroundColor(isSelected ? .primary : .secondary)
                .multilineTextAlignment(.center)
        }
        .animation(.easeInOut(duration: 0.15), value: isHovered)
        .animation(.easeInOut(duration: 0.2), value: isSelected)
        .onHover { hovering in
            hoveredSlot = hovering ? index : nil
        }
        .onTapGesture {
            selectedSlot = selectedSlot == index ? nil : index
        }
    }
    
    private func systemIconName(for index: Int) -> String {
        switch index {
        case 0: return "doc.text"
        case 1: return "arrow.down.circle"
        case 2: return "desktopcomputer"
        case 3: return "photo"
        case 4: return "music.note"
        case 5: return "video"
        case 6: return "folder.badge.gearshape"
        case 7: return "archivebox"
        default: return "folder"
        }
    }
}