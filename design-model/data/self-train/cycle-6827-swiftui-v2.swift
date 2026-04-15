struct ContentView: View {
    @State private var currentMessage: TemporaryMessage? = TemporaryMessage(
        words: ["Every", "word", "we", "write", "dissolves", "like", "morning", "mist"],
        createdAt: Date()
    )
    
    @State private var dissolvedWords: [DissolvedWord] = []
    @State private var currentWordIndex: Int = 0
    @State private var watermarks: [Watermark] = []
    
    let palette = [
        Color(red: 0.85, green: 0.87, blue: 0.92),
        Color(red: 0.92, green: 0.85, blue: 0.87),
        Color(red: 0.87, green: 0.92, blue: 0.85)
    ]
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color(red: 0.98, green: 0.97, blue: 0.95)
                    .ignoresSafeArea()
                
                ForEach(watermarks) { mark in
                    WatermarkView(mark: mark)
                }
                
                VStack(spacing: 0) {
                    Spacer()
                        .frame(height: geometry.size.height * 0.3)
                    
                    if let message = currentMessage {
                        VStack(spacing: 8) {
                            ForEach(Array(message.words.enumerated()), id: \.0) { index, word in
                                if index <= currentWordIndex {
                                    Text(word)
                                        .font(.custom("Georgia", size: 28))
                                        .foregroundColor(.black.opacity(0.8))
                                        .opacity(index == currentWordIndex ? 1.0 : 0.3)
                                        .animation(.easeInOut(duration: 2.0), value: currentWordIndex)
                                        .onAppear {
                                            if index == currentWordIndex {
                                                dissolveWord(word, index: index, in: geometry)
                                            }
                                        }
                                }
                            }
                        }
                        .frame(width: geometry.size.width * 0.6)
                    }
                    
                    Spacer()
                    
                    VStack(spacing: 0) {
                        ForEach(dissolvedWords.suffix(3)) { word in
                            HStack(spacing: 4) {
                                ForEach(word.text.map { String($0) }, id: \.self) { letter in
                                    Text(letter)
                                        .font(.custom("Georgia", size: 16))
                                        .foregroundColor(word.color.opacity(0.3))
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    }
                    .frame(height: geometry.size.height * 0.15)
                    .frame(maxWidth: .infinity)
                    .background(
                        LinearGradient(
                            colors: [Color.clear, Color.black.opacity(0.02)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                }
            }
        }
        .onAppear { startReading() }
    }
    
    func dissolveWord(_ word: String, index: Int, in geometry: GeometryProxy) {
        let color = palette[index % palette.count]
        
        withAnimation(.easeInOut(duration: 3.0)) {
            dissolvedWords.append(DissolvedWord(
                id: UUID(),
                text: word,
                color: color,
                position: CGPoint(
                    x: geometry.size.width / 2,
                    y: geometry.size.height * 0.3 + CGFloat(index * 40)
                ),
                opacity: 0.7
            ))
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            watermarks.append(Watermark(
                id: UUID(),
                position: CGPoint(
                    x: geometry.size.width / 2 + CGFloat.random(in: -50...50),
                    y: geometry.size.height * 0.3 + CGFloat(index * 40)
                ),
                color: color,
                size: CGFloat.random(in: 60...100)
            ))
        }
    }
    
    func startReading() {
        Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
            if let message = currentMessage {
                if currentWordIndex < message.words.count - 1 {
                    withAnimation {
                        currentWordIndex += 1
                    }
                } else {
                    currentMessage = nil
                }
            }
        }
    }
}

struct WatermarkView: View {
    let mark: Watermark
    @State private var opacity: Double = 0
    
    var body: some View {
        Circle()
            .fill(mark.color.opacity(opacity))
            .frame(width: mark.size, height: mark.size)
            .blur(radius: mark.size / 4)
            .position(mark.position)
            .onAppear {
                withAnimation(.easeIn(duration: 4.0)) {
                    opacity = 0.08
                }
            }
    }
}

struct DissolvedWord {
    let id: UUID
    let text: String
    let color: Color
    let position: CGPoint
    let opacity: Double
}

struct Watermark {
    let id: UUID
    let position: CGPoint
    let color: Color
    let size: CGFloat
}

struct TemporaryMessage {
    let id = UUID()
    let words: [String]
    let createdAt: Date
}

extension DissolvedWord: Identifiable {}
extension Watermark: Identifiable {}