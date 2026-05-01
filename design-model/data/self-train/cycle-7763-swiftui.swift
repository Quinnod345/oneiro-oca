struct ContentView: View {
    @State private var currentExpression: String = ""
    @State private var dreamNumbers: [DreamNumber] = []
    @State private var mood: CalculatorMood = CalculatorMood()
    @State private var isAsleep: Bool = false
    @State private var cloudOpacity: Double = 0.3
    @State private var waterLevel: Double = 0
    @State private var gardenGrowth: Double = 0
    @State private var floatingThoughts: [FloatingThought] = []
    @State private var lastPetPosition: CGPoint = .zero
    @State private var breathingScale: Double = 1.0
    @State private var dreamLogic: Bool = true
    
    let operations = [
        DreamOperation(symbol: "☁️", metaphor: "multiply by imagination", color: Color(red: 0.8, green: 0.9, blue: 1.0)),
        DreamOperation(symbol: "💧", metaphor: "emotional remainder", color: Color(red: 0.7, green: 0.85, blue: 0.95)),
        DreamOperation(symbol: "🌱", metaphor: "growth function", color: Color(red: 0.7, green: 0.9, blue: 0.7)),
        DreamOperation(symbol: "✨", metaphor: "quantum possibility", color: Color(red: 1.0, green: 0.9, blue: 0.7))
    ]
    
    var body: some View {
        ZStack {
            // Living background
            Canvas { context, size in
                let gradient = Gradient(colors: [
                    Color(red: 0.05 + mood.dreamDepth * 0.1, green: 0.05 + mood.trust * 0.1, blue: 0.1 + mood.whimsy * 0.2),
                    Color(red: 0.1 + mood.whimsy * 0.1, green: 0.05 + mood.dreamDepth * 0.15, blue: 0.15 + mood.trust * 0.1)
                ])
                context.fill(Path(CGRect(origin: .zero, size: size)), with: .linearGradient(gradient, startPoint: .zero, endPoint: CGPoint(x: size.width, y: size.height)))
            }
            .ignoresSafeArea()
            .blur(radius: isAsleep ? 20 : 0)
            
            // Dream particles
            ForEach(0..<30, id: \.self) { index in
                Circle()
                    .fill(Color(red: 0.9, green: 0.9, blue: 1.0).opacity(0.1))
                    .frame(width: CGFloat.random(in: 20...80))
                    .position(
                        x: CGFloat.random(in: 0...1440),
                        y: CGFloat.random(in: 0...900)
                    )
                    .offset(y: sin(Double(index) + Date().timeIntervalSince1970 * 0.5) * 20)
                    .blur(radius: 3)
            }
            
            VStack(spacing: 40) {
                // Calculator face
                ZStack {
                    // Breathing circle
                    Circle()
                        .fill(Color(red: 0.1, green: 0.1, blue: 0.2).opacity(0.8))
                        .frame(width: 400 * breathingScale, height: 400 * breathingScale)
                        .blur(radius: 10)
                    
                    // Eyes
                    HStack(spacing: 80) {
                        Eye(isOpen: !isAsleep, mood: mood)
                        Eye(isOpen: !isAsleep, mood: mood)
                    }
                    .offset(y: -50)
                    
                    // Expression display
                    Text(currentExpression.isEmpty ? "..." : currentExpression)
                        .font(.system(size: 32, weight: .light, design: .serif))
                        .foregroundColor(Color(red: 0.9, green: 0.9, blue: 1.0))
                        .opacity(isAsleep ? 0.3 : 1.0)
                        .offset(y: 50)
                        .rotationEffect(.degrees(mood.whimsy * 5 - 2.5))
                }
                .scaleEffect(breathingScale)
                .onAppear { animateBreathing() }
                .onTapGesture { location in
                    petCalculator(at: location)
                }
                
                // Dream workspace
                ZStack {
                    // Cloud layer
                    ForEach(0..<5, id: \.self) { index in
                        Cloud(opacity: cloudOpacity * (1.0 - Double(index) * 0.15))
                            .offset(x: CGFloat(index * 100 - 200), y: CGFloat(index * 30 - 60))
                    }
                    
                    // Water pool
                    if waterLevel > 0 {
                        WaterPool(level: waterLevel, mood: mood)
                            .frame(height: 200)
                    }
                    
                    // Garden
                    if gardenGrowth > 0 {
                        MathematicalGarden(growth: gardenGrowth, expression: currentExpression)
                    }
                    
                    // Floating numbers
                    ForEach(dreamNumbers) { number in
                        DreamNumberView(number: number, mood: mood)
                            .position(number.position)
                            .onTapGesture {
                                selectNumber(number)
                            }
                    }
                    
                    // Floating thoughts
                    ForEach(floatingThoughts) { thought in
                        Text(thought.text)
                            .font(.system(size: 14, weight: .light, design: .serif))
                            .foregroundColor(Color(red: 0.8, green: 0.8, blue: 1.0))
                            .opacity(thought.opacity)
                            .position(thought.position)
                    }
                }
                .frame(height: 300)
                .clipShape(RoundedRectangle(cornerRadius: 30))
                .overlay(
                    RoundedRectangle(cornerRadius: 30)
                        .stroke(Color(red: 0.3, green: 0.3, blue: 0.5).opacity(0.3), lineWidth: 1)
                )
                
                // Dream operations
                HStack(spacing: 30) {
                    ForEach(operations, id: \.id) { operation in
                        DreamOperationButton(operation: operation, mood: mood) {
                            applyDreamOperation(operation)
                        }
                    }
                }
            }
            .padding(40)
        }
    }
    
    func animateBreathing() {
        withAnimation(Animation.easeInOut(duration: 3).repeatForever(autoreverses: true)) {
            breathingScale = 1.05
        }
    }
    
    func petCalculator(at location: CGPoint) {
        lastPetPosition = location
        mood.trust = min(1.0, mood.trust + 0.1)
        mood.whimsy = Double.random(in: 0.3...0.7)
        
        let thought = FloatingThought(
            text: ["hmm...", "✨", "...?", "💭", "∞"][Int.random(in: 0...4)],
            position: location,
            opacity: 1.0
        )
        floatingThoughts.append(thought)
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            floatingThoughts.removeAll { $0.id == thought.id }
        }
    }
    
    func selectNumber(_ number: DreamNumber) {
        currentExpression += number.dreamForm
        mood.dreamDepth = min(1.0, mood.dreamDepth + 0.05)
    }
    
    func applyDreamOperation(_ operation: DreamOperation) {
        switch operation.symbol {
        case "☁️":
            cloudOpacity = min(0.8, cloudOpacity + 0.1)
            let newNumber = DreamNumber(
                value: Double.random(in: 1...100),
                position: CGPoint(x: CGFloat.random(in: 50...350), y: CGFloat.random(in: 50...250)),
                dreamForm: ["π", "∞", "φ", "e", "i"][Int.random(in: 0...4)]
            )
            dreamNumbers.append(newNumber)
        case "💧":
            waterLevel = min(1.0, waterLevel + 0.2)
            mood.trust += 0.1
        case "🌱":
            gardenGrowth = min(1.0, gardenGrowth + 0.2)
            mood.whimsy += 0.1
        case "✨":
            dreamLogic.toggle()
            mood.dreamDepth = Double.random(in: 0.5...1.0)
        default:
            break
        }
    }
}