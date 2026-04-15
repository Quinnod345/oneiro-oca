struct ContentView: View {
    @State private var currentMessage: TemporaryMessage? = TemporaryMessage(
        words: ["Every", "word", "we", "write", "dissolves", "like", "morning", "mist,", 
                "leaving", "only", "the", "ghost", "of", "meaning", "in", "watercolor", "stains"],
        createdAt: Date()
    )
    
    @State private var dissolvedWords: [DissolvedWord] = []
    @State private var waterBleeds: [WaterBleed] = []
    @State private var readingSpeed: Double = 0
    @State private var lastReadTime: Date = Date()
    @State private var currentWordIndex: Int = 0
    @State private var draggedWord: DissolvedWord?
    @State private var paperStains: [CGPoint] = []
    
    let baseColors = [
        Color(red: 0.2, green: 0.4, blue: 0.7),
        Color(red: 0.5, green: 0.2, blue: 0.6),
        Color(red: 0.7, green: 0.3, blue: 0.4),
        Color(red: 0.3, green: 0.6, blue: 0.5)
    ]
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Paper texture background
                Canvas { context, size in
                    context.fill(
                        Path(CGRect(origin: .zero, size: size)),
                        with: .color(Color(red: 0.98, green: 0.97, blue: 0.95))
                    )
                    
                    // Water stains
                    for stain in paperStains {
                        let stainPath = Path(ellipseIn: CGRect(
                            x: stain.x - 40,
                            y: stain.y - 30,
                            width: 80,
                            height: 60
                        ))
                        
                        context.fill(
                            stainPath,
                            with: .color(Color(red: 0.92, green: 0.91, blue: 0.89).opacity(0.3))
                        )
                    }
                    
                    // Ripple effects
                    for bleed in waterBleeds {
                        context.drawLayer { layer in
                            layer.opacity = bleed.opacity
                            
                            for ring in 0..<3 {
                                let ringRadius = bleed.radius * (1.0 + Double(ring) * 0.2)
                                let ringPath = Path(ellipseIn: CGRect(
                                    x: bleed.center.x - ringRadius,
                                    y: bleed.center.y - ringRadius,
                                    width: ringRadius * 2,
                                    height: ringRadius * 2
                                ))
                                
                                layer.stroke(
                                    ringPath,
                                    with: .color(bleed.color.opacity(0.1)),
                                    lineWidth: 1
                                )
                            }
                        }
                    }
                }
                
                // Active message
                if let message = currentMessage {
                    VStack(spacing: 20) {
                        ForEach(Array(message.words.enumerated()), id: \.0) { index, word in
                            if index <= currentWordIndex {
                                WordView(
                                    word: word,
                                    index: index,
                                    totalWords: message.words.count,
                                    readingSpeed: readingSpeed,
                                    onDissolve: { position, color in
                                        dissolveWord(word, at: position, with: color, index: index)
                                    }
                                )
                                .frame(width: geometry.size.width * 0.8)
                            }
                        }
                    }
                    .padding(.top, 100)
                }
                
                // Dissolved words layer
                ForEach(dissolvedWords) { word in
                    DissolvingWordView(
                        word: word,
                        onDrag: { draggedWord = word },
                        onDrop: { salvageWord(word) }
                    )
                }
                
                // Bottom pool
                VStack {
                    Spacer()
                    
                    Canvas { context, size in
                        let gradient = Gradient(colors: [
                            Color(red: 0.2, green: 0.3, blue: 0.5).opacity(0.3),
                            Color(red: 0.3, green: 0.4, blue: 0.6).opacity(0.1),
                            Color.clear
                        ])
                        
                        context.fill(
                            Path(CGRect(origin: .zero, size: size)),
                            with: .linearGradient(
                                gradient,
                                startPoint: CGPoint(x: 0, y: size.height),
                                endPoint: CGPoint(x: 0, y: 0)
                            )
                        )
                    }
                    .frame(height: 200)
                    .blur(radius: 20)
                }
                
                // Reading progress indicator
                VStack {
                    HStack {
                        Text("Reading Speed")
                            .font(.system(size: 12, weight: .light, design: .serif))
                            .foregroundColor(Color(red: 0.4, green: 0.4, blue: 0.4))
                        
                        Rectangle()
                            .fill(Color(red: 0.7, green: 0.3, blue: 0.4))
                            .frame(width: readingSpeed * 100, height: 2)
                            .animation(.easeOut(duration: 0.3), value: readingSpeed)
                        
                        Spacer()
                    }
                    .padding()
                    
                    Spacer()
                }
            }
        }
        .onAppear {
            startReading()
        }
    }
    
    func dissolveWord(_ word: String, at position: CGPoint, with color: Color, index: Int) {
        let dissolvedWord = DissolvedWord(
            text: word,
            position: position,
            color: color,
            createdAt: Date()
        )
        
        dissolvedWords.append(dissolvedWord)
        
        let bleed = WaterBleed(
            center: position,
            color: color,
            radius: 10,
            opacity: 0.5
        )
        
        waterBleeds.append(bleed)
        
        withAnimation(.easeOut(duration: 2.0)) {
            if let index = waterBleeds.firstIndex(where: { $0.id == bleed.id }) {
                waterBleeds[index].radius = 50
                waterBleeds[index].opacity = 0
            }
        }
        
        paperStains.append(position)
    }
    
    func salvageWord(_ word: DissolvedWord) {
        dissolvedWords.removeAll { $0.id == word.id }
    }
    
    func startReading() {
        Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
            if currentWordIndex < (currentMessage?.words.count ?? 0) - 1 {
                currentWordIndex += 1
                let timeElapsed = Date().timeIntervalSince(lastReadTime)
                readingSpeed = min(1.0, 1.0 / max(0.1, timeElapsed))
                lastReadTime = Date()
            }
        }
    }
}

struct WordView: View {
    let word: String
    let index: Int
    let totalWords: Int
    let readingSpeed: Double
    let onDissolve: (CGPoint, Color) -> Void
    
    @State private var opacity: Double = 1.0
    @State private var blur: Double = 0
    @State private var offset: CGSize = .zero
    @State private var scale: Double = 1.0
    
    var body: some View {
        Text(word)
            .font(.system(size: 24, weight: .light, design: .serif))
            .foregroundColor(Color(red: 0.2, green: 0.2, blue: 0.3).opacity(opacity))
            .blur(radius: blur)
            .scaleEffect(scale)
            .offset(offset)
            .onAppear {
                withAnimation(.easeOut(duration: 3.0).delay(Double(index) * 0.2)) {
                    opacity = 0.3
                    blur = 2
                    offset = CGSize(width: 0, height: 20)
                    scale = 0.9
                }
                
                DispatchQueue.main.asyncAfter(deadline: .now() + 3.5 + Double(index) * 0.2) {
                    GeometryReader { geo in
                        let globalFrame = geo.frame(in: .global)
                        let position = CGPoint(x: globalFrame.midX, y: globalFrame.midY)
                        onDissolve(position, Color(red: 0.2, green: 0.4, blue: 0.7))
                    }
                    .frame(width: 0, height: 0)
                }
            }
    }
}

struct DissolvingWordView: View {
    let word: DissolvedWord
    let onDrag: () -> Void
    let onDrop: () -> Void
    
    @State private var position: CGPoint
    @State private var opacity: Double = 0.6
    @State private var rotation: Double = 0
    
    init(word: DissolvedWord, onDrag: @escaping () -> Void, onDrop: @escaping () -> Void) {
        self.word = word
        self.onDrag = onDrag
        self.onDrop = onDrop
        self._position = State(initialValue: word.position)
    }
    
    var body: some View {
        Text(word.text)
            .font(.system(size: 18, weight: .ultraLight, design: .serif))
            .foregroundColor(word.color.opacity(opacity))
            .rotationEffect(.degrees(rotation))
            .position(position)
            .onAppear {
                withAnimation(.easeInOut(duration: 4.0).repeatForever(autoreverses: true)) {
                    rotation = 10
                }
                
                withAnimation(.easeOut(duration: 10.0)) {
                    position.y += 200
                    opacity = 0.1
                }
            }
            .gesture(
                DragGesture()
                    .onChanged { value in
                        position = value.location
                        onDrag()
                    }
                    .onEnded { _ in
                        onDrop()
                    }
            )
    }
}