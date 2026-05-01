struct ContentView: View {
    @State private var memories: [MemoryFragment] = [
        MemoryFragment(text: "the smell of her pancakes on Sunday morning", position: CGPoint(x: 400, y: 300)),
        MemoryFragment(text: "hiding under the kitchen table during thunderstorms", position: CGPoint(x: 800, y: 450)),
        MemoryFragment(text: "the weight of her hand on my forehead checking for fever", position: CGPoint(x: 600, y: 600))
    ]
    
    @State private var cursorPosition: CGPoint = .zero
    @State private var hoveredMemoryID: UUID?
    
    let revealRadius: Double = 150
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Clean background
                LinearGradient(
                    colors: [
                        Color(red: 0.95, green: 0.96, blue: 0.98),
                        Color(red: 0.92, green: 0.93, blue: 0.95)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()
                
                // Subtle texture overlay
                RadialGradient(
                    colors: [
                        Color.white.opacity(0.8),
                        Color(red: 0.85, green: 0.88, blue: 0.92).opacity(0.3)
                    ],
                    center: .center,
                    startRadius: 100,
                    endRadius: 800
                )
                .blendMode(.overlay)
                
                // Memory fragments
                ForEach(memories.indices, id: \.self) { index in
                    let memory = memories[index]
                    let distance = sqrt(pow(cursorPosition.x - memory.position.x, 2) + pow(cursorPosition.y - memory.position.y, 2))
                    let proximity = max(0, 1 - (distance / revealRadius))
                    let isNear = distance < revealRadius
                    
                    VStack(spacing: 12) {
                        Text(memory.text)
                            .font(.system(size: 18, weight: .light, design: .serif))
                            .foregroundColor(Color(red: 0.2, green: 0.25, blue: 0.35))
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: 300)
                            .opacity(memory.isRevealed ? 0.9 : proximity * 0.8)
                            .blur(radius: memory.isRevealed ? 0 : (1 - proximity) * 3)
                            .scaleEffect(memory.isRevealed ? 1.0 : 0.95 + proximity * 0.05)
                        
                        if memory.isRevealed && index == 0 {
                            Text("1982")
                                .font(.system(size: 14, weight: .ultraLight, design: .serif))
                                .foregroundColor(Color(red: 0.4, green: 0.45, blue: 0.55))
                                .opacity(0.6)
                        }
                    }
                    .position(memory.position)
                    .background(
                        Circle()
                            .fill(Color.white.opacity(isNear ? 0.3 : 0))
                            .frame(width: 200, height: 200)
                            .blur(radius: 40)
                            .position(memory.position)
                            .animation(.easeInOut(duration: 0.6), value: isNear)
                    )
                    .onTapGesture {
                        if proximity > 0.5 {
                            withAnimation(.easeOut(duration: 0.4)) {
                                memories[index].isRevealed.toggle()
                            }
                        }
                    }
                }
                
                // Interactive hint
                if !memories.contains(where: { $0.isRevealed }) {
                    Text("move closer to remember")
                        .font(.system(size: 14, weight: .light, design: .serif))
                        .foregroundColor(Color(red: 0.5, green: 0.55, blue: 0.65))
                        .position(x: geometry.size.width / 2, y: geometry.size.height - 60)
                        .opacity(0.6)
                }
            }
            .onContinuousHover { phase in
                switch phase {
                case .active(let location):
                    cursorPosition = location
                case .ended:
                    break
                }
            }
        }
    }
}