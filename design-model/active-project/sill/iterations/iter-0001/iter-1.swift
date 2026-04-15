struct ContentView: View {
    @State private var isVisible: Bool = false
    private let slots: [ShelfSlot] = Array(repeating: ShelfSlot(), count: 8)
    
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                Button(action: { 
                    withAnimation(.easeInOut(duration: 0.3)) {
                        isVisible.toggle() 
                    }
                }) {
                    Image(systemName: isVisible ? "chevron.up" : "chevron.down")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                        .frame(width: 20, height: 20)
                }
                .buttonStyle(PlainButtonStyle())
                .padding(.trailing, 20)
                .padding(.top, 8)
            }
            
            if isVisible {
                HStack(spacing: 16) {
                    ForEach(slots) { slot in
                        slot
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(.regularMaterial)
                        .shadow(color: Color.black.opacity(0.1), radius: 3, x: 0, y: 2)
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            }
            
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.contentBackground)
    }
}

struct ShelfSlot: View, Identifiable {
    let id = UUID()
    
    var body: some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(.quaternary)
            .frame(width: 40, height: 40)
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .strokeBorder(.tertiary, lineWidth: 0.5)
            )
    }
}