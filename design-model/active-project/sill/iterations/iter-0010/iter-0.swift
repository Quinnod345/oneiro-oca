struct ContentView: View {
    @State private var hoveredSlot: Int? = nil
    @State private var selectedSlot: Int? = nil
    
    var body: some View {
        ZStack {
            // Soft vignette background
            RadialGradient(
                colors: [
                    Color(red: 0.96, green: 0.94, blue: 0.91),
                    Color(red: 0.89, green: 0.85, blue: 0.78)
                ],
                center: .center,
                startRadius: 200,
                endRadius: 800
            )
            .ignoresSafeArea()
            
            // Main wooden shelf
            VStack(spacing: 0) {
                Spacer()
                
                ZStack {
                    // Base shelf structure
                    RoundedRectangle(cornerRadius: 12)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.72, green: 0.52, blue: 0.35),
                                    Color(red: 0.65, green: 0.45, blue: 0.28),
                                    Color(red: 0.58, green: 0.38, blue: 0.22)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 720, height: 120)
                        .shadow(color: Color(red: 0.35, green: 0.25, blue: 0.15).opacity(0.4), radius: 8, x: 0, y: 6)
                        .shadow(color: Color(red: 0.45, green: 0.32, blue: 0.18).opacity(0.2), radius: 20, x: 0, y: 12)
                    
                    // Wood grain overlay
                    RoundedRectangle(cornerRadius: 12)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.68, green: 0.48, blue: 0.31).opacity(0.3),
                                    Color.clear,
                                    Color(red: 0.55, green: 0.35, blue: 0.20).opacity(0.4),
                                    Color.clear,
                                    Color(red: 0.62, green: 0.42, blue: 0.25).opacity(0.2)
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: 720, height: 120)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    
                    // Slot container
                    HStack(spacing: 20) {
                        ForEach(0..<8, id: \.self) { index in
                            slotView(for: index)
                        }
                    }
                    .padding(.horizontal, 40)
                }
                
                Spacer()
            }
        }
        .frame(width: 1440, height: 900)
    }
    
    private func slotView(for index: Int) -> some View {
        let isHovered = hoveredSlot == index
        let isSelected = selectedSlot == index
        
        return ZStack {
            // Carved depression base
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(red: 0.42, green: 0.28, blue: 0.15),
                            Color(red: 0.48, green: 0.32, blue: 0.18),
                            Color(red: 0.55, green: 0.37, blue: 0.22)
                        ],
                        center: .center,
                        startRadius: 10,
                        endRadius: 40
                    )
                )
                .frame(width: 70, height: 70)
                .overlay(
                    Circle()
                        .stroke(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.38, green: 0.24, blue: 0.12),
                                    Color(red: 0.52, green: 0.34, blue: 0.20)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 1.5
                        )
                )
                .scaleEffect(isSelected ? 1.05 : (isHovered ? 1.02 : 1.0))
                .shadow(
                    color: Color(red: 0.25, green: 0.15, blue: 0.08).opacity(0.8),
                    radius: isSelected ? 6 : (isHovered ? 4 : 3),
                    x: 0,
                    y: isSelected ? -2 : (isHovered ? -1 : -0.5)
                )
            
            // Inner shadow for depth
            Circle()
                .stroke(
                    LinearGradient(
                        colors: [
                            Color(red: 0.35, green: 0.21, blue: 0.10).opacity(0.6),
                            Color.clear
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 2
                )
                .frame(width: 66, height: 66)
                .opacity(isHovered ? 0.8 : 1.0)
            
            // Subtle highlight for realism
            Circle()
                .stroke(
                    LinearGradient(
                        colors: [
                            Color.clear,
                            Color(red: 0.78, green: 0.58, blue: 0.41).opacity(0.3)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
                .frame(width: 68, height: 68)
                .opacity(isSelected ? 1.0 : 0.7)
        }
        .onHover { hovering in
            hoveredSlot = hovering ? index : nil
        }
        .onTapGesture {
            selectedSlot = selectedSlot == index ? nil : index
        }
        .animation(.easeInOut(duration: 0.15), value: isHovered)
        .animation(.easeInOut(duration: 0.2), value: isSelected)
    }
}