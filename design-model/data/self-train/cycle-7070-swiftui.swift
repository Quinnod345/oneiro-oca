struct ContentView: View {
    @State private var fragments: [DreamFragment] = []
    @State private var currentInput: String = ""
    @State private var isDrawingCircle: Bool = false
    @State private var circleStart: CGPoint = .zero
    @State private var circleEnd: CGPoint = .zero
    @State private var protectiveCircles: [(center: CGPoint, radius: CGFloat)] = []
    @State private var currentTimeOfDay: TimeOfDay = .morning
    @State private var canvasOffset: CGSize = .zero
    @State private var breathingScale: CGFloat = 1.0
    
    let dreamColors: [Color] = [
        Color(red: 0.6, green: 0.4, blue: 0.8),
        Color(red: 0.3, green: 0.6, blue: 0.7),
        Color(red: 0.8, green: 0.5, blue: 0.4),
        Color(red: 0.5, green: 0.7, blue: 0.5),
        Color(red: 0.7, green: 0.4, blue: 0.6),
        Color(red: 0.4, green: 0.5, blue: 0.8)
    ]
    
    var body: some View {
        ZStack {
            // Base paper texture
            Color(red: 0.98, green: 0.97, blue: 0.95)
                .overlay(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.3),
                            Color.clear,
                            Color.black.opacity(0.05)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
            
            // Fog layer based on time of day
            Color.gray.opacity(currentTimeOfDay.fogOpacity * 0.3)
                .blur(radius: 40)
                .animation(.easeInOut(duration: 3.0), value: currentTimeOfDay)
            
            // Dream fragments canvas
            ZStack {
                ForEach(fragments) { fragment in
                    WatercolorBloom(fragment: fragment)
                }
                
                ForEach(protectiveCircles.indices, id: \.self) { index in
                    ProtectiveCircle(
                        center: protectiveCircles[index].center,
                        radius: protectiveCircles[index].radius
                    )
                }
                
                if isDrawingCircle {
                    Circle()
                        .stroke(Color.black.opacity(0.3), lineWidth: 1)
                        .frame(
                            width: abs(circleEnd.x - circleStart.x),
                            height: abs(circleEnd.x - circleStart.x)
                        )
                        .position(
                            x: (circleStart.x + circleEnd.x) / 2,
                            y: (circleStart.y + circleEnd.y) / 2
                        )
                }
            }
            .scaleEffect(breathingScale)
            .offset(canvasOffset)
            .gesture(
                DragGesture()
                    .onChanged { value in
                        if isDrawingCircle {
                            circleEnd = value.location
                        }
                    }
                    .onEnded { _ in
                        if isDrawingCircle {
                            let radius = abs(circleEnd.x - circleStart.x) / 2
                            let center = CGPoint(
                                x: (circleStart.x + circleEnd.x) / 2,
                                y: (circleStart.y + circleEnd.y) / 2
                            )
                            protectiveCircles.append((center: center, radius: radius))
                            updatePinnedFragments()
                        }
                        isDrawingCircle = false
                    }
            )
            
            // Input area
            VStack {
                Spacer()
                
                HStack(spacing: 20) {
                    TextField("whisper a dream fragment...", text: $currentInput)
                        .textFieldStyle(.plain)
                        .font(.system(size: 16, weight: .light, design: .serif))
                        .foregroundColor(Color.black.opacity(0.7))
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(Color.white.opacity(0.7))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(Color.black.opacity(0.1), lineWidth: 1)
                                )
                        )
                        .frame(width: 400)
                        .onSubmit {
                            addDreamFragment()
                        }
                    
                    Button(action: { isDrawingCircle.toggle() }) {
                        Image(systemName: isDrawingCircle ? "pencil.circle.fill" : "pencil.circle")
                            .font(.system(size: 20))
                            .foregroundColor(isDrawingCircle ? Color.black : Color.black.opacity(0.5))
                    }
                    .buttonStyle(.plain)
                    
                    Menu {
                        Button("Night") { currentTimeOfDay = .night }
                        Button("Dawn") { currentTimeOfDay = .dawn }
                        Button("Morning") { currentTimeOfDay = .morning }
                        Button("Afternoon") { currentTimeOfDay = .afternoon }
                        Button("Evening") { currentTimeOfDay = .evening }
                    } label: {
                        Image(systemName: "moon.stars")
                            .font(.system(size: 20))
                            .foregroundColor(Color.black.opacity(0.5))
                    }
                    .menuStyle(.borderlessButton)
                }
                .padding(.bottom, 40)
            }
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            startBreathing()
        }
        .onReceive(Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()) { _ in
            updateFloatingFragments()
        }
    }
    
    func addDreamFragment() {
        guard !currentInput.isEmpty else { return }
        
        let newFragment = DreamFragment(
            text: currentInput,
            position: CGPoint(
                x: CGFloat.random(in: 100...1340),
                y: CGFloat.random(in: 100...700)
            ),
            color: dreamColors.randomElement() ?? Color.purple,
            opacity: Double.random(in: 0.6...1.0),
            scale: CGFloat.random(in: 0.8...1.2),
            rotation: Double.random(in: -15...15)
        )
        
        fragments.append(newFragment)
        currentInput = ""
    }
    
    func updateFloatingFragments() {
        for index in fragments.indices {
            guard !fragments[index].isPinned else { continue }
            
            let time = Date().timeIntervalSinceReferenceDate
            let offsetX = sin(time * 0.5 + Double(index)) * 2
            let offsetY = cos(time * 0.3 + Double(index)) * 2
            
            fragments[index].position.x += offsetX
            fragments[index].position.y += offsetY
            
            // Gently drift opacity
            fragments[index].opacity = 0.6 + sin(time * 0.2 + Double(index)) * 0.4
        }
    }
    
    func updatePinnedFragments() {
        for index in fragments.indices {
            for circle in protectiveCircles {
                let distance = hypot(
                    fragments[index].position.x - circle.center.x,
                    fragments[index].position.y - circle.center.y
                )
                if distance <= circle.radius {
                    fragments[index].isPinned = true
                }
            }
        }
    }
    
    func startBreathing() {
        withAnimation(.easeInOut(duration: 4).repeatForever(autoreverses: true)) {
            breathingScale = 1.05
        }
    }
}