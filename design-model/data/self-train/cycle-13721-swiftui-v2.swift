struct ContentView: View {
    @State private var dreams: [Dream] = []
    @State private var selectedDream: Dream? = nil
    @State private var dragOffset: CGSize = .zero
    @State private var isDragging: Bool = false
    
    let dreamWords = ["whisper", "float", "memory", "light", "shadow", "echo"]
    let palette = [
        Color(red: 0.2, green: 0.3, blue: 0.5),
        Color(red: 0.3, green: 0.4, blue: 0.6),
        Color(red: 0.4, green: 0.5, blue: 0.7)
    ]
    
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(white: 0.05), Color(white: 0.1)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            
            ForEach(dreams) { dream in
                DreamBubbleView(
                    dream: dream,
                    isSelected: selectedDream?.id == dream.id,
                    onTap: { selectedDream = selectedDream?.id == dream.id ? nil : dream }
                )
                .position(dream.position)
                .animation(.easeInOut(duration: 0.3), value: selectedDream?.id)
            }
            
            VStack {
                Spacer()
                
                HStack {
                    ForEach(dreamWords, id: \.self) { word in
                        Button(action: { addDream(word: word) }) {
                            Text(word)
                                .font(.system(size: 14, weight: .medium, design: .rounded))
                                .foregroundColor(.white.opacity(0.8))
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                                .background(
                                    Capsule()
                                        .fill(palette.randomElement() ?? palette[0])
                                        .opacity(0.3)
                                )
                                .overlay(
                                    Capsule()
                                        .stroke(Color.white.opacity(0.2), lineWidth: 1)
                                )
                        }
                    }
                }
                .padding(.bottom, 40)
            }
        }
    }
    
    func addDream(word: String) {
        let newDream = Dream(
            word: word,
            position: CGPoint(
                x: CGFloat.random(in: 100...UIScreen.main.bounds.width - 100),
                y: CGFloat.random(in: 100...UIScreen.main.bounds.height - 200)
            ),
            color: palette.randomElement() ?? palette[0]
        )
        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
            dreams.append(newDream)
        }
    }
}

struct Dream: Identifiable {
    let id = UUID()
    let word: String
    var position: CGPoint
    let color: Color
}

struct DreamBubbleView: View {
    let dream: Dream
    let isSelected: Bool
    let onTap: () -> Void
    
    var body: some View {
        Text(dream.word)
            .font(.system(size: 16, weight: .light, design: .serif))
            .foregroundColor(.white)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(
                ZStack {
                    Circle()
                        .fill(dream.color.opacity(0.2))
                        .blur(radius: isSelected ? 20 : 10)
                        .scaleEffect(isSelected ? 1.3 : 1.0)
                    
                    Circle()
                        .fill(dream.color.opacity(0.1))
                        .overlay(
                            Circle()
                                .stroke(Color.white.opacity(0.2), lineWidth: 1)
                        )
                }
            )
            .scaleEffect(isSelected ? 1.1 : 1.0)
            .onTapGesture { onTap() }
    }
}