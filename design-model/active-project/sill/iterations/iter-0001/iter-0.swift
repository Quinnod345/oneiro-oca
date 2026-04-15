struct ContentView: View {
    @State private var isVisible: Bool = false
    private let slots: [ShelfSlot] = Array(repeating: ShelfSlot(), count: 8)
    
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                Button(action: { isVisible.toggle() }) {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.75, green: 0.62, blue: 0.45),
                                    Color(red: 0.65, green: 0.52, blue: 0.35)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 22, height: 22)
                        .overlay(
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Color(red: 0.35, green: 0.25, blue: 0.15))
                                .frame(width: 8, height: 6)
                        )
                        .shadow(color: Color.black.opacity(0.2), radius: 2, x: 0, y: 1)
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
                    RoundedRectangle(cornerRadius: 16)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.82, green: 0.68, blue: 0.52),
                                    Color(red: 0.72, green: 0.58, blue: 0.42),
                                    Color(red: 0.62, green: 0.48, blue: 0.32)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .overlay(WoodGrainTexture())
                        .shadow(color: Color.black.opacity(0.4), radius: 12, x: 0, y: 4)
                )
                .transition(.asymmetric(
                    insertion: .move(edge: .top).combined(with: .opacity),
                    removal: .move(edge: .top).combined(with: .opacity)
                ))
                .animation(.spring(response: 0.4, dampingFraction: 0.8), value: isVisible)
            }
            
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.clear)
    }
}