struct ContentView: View {
    @State private var currentEmotions: [EmotionGradient] = []
    @State private var severity: CGFloat = 0.5
    @State private var selectedType: TransgressionType = .social
    @State private var skyLanterns: [FloatingLantern] = []
    @State private var gardenSeeds: [ReconciliationSeed] = []
    @State private var composingApology: Bool = false
    @State private var matchingExperience: ExperiencePattern?
    @State private var hoveredLantern: UUID?
    @State private var animationTimer: Timer?
    
    let emotionPalette = [
        (Color(red: 0.9, green: 0.3, blue: 0.3), Color(red: 0.7, green: 0.2, blue: 0.2)),
        (Color(red: 0.3, green: 0.5, blue: 0.8), Color(red: 0.2, green: 0.3, blue: 0.6)),
        (Color(red: 0.8, green: 0.6, blue: 0.3), Color(red: 0.6, green: 0.4, blue: 0.2)),
        (Color(red: 0.5, green: 0.7, blue: 0.5), Color(red: 0.3, green: 0.5, blue: 0.3))
    ]
    
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.05, blue: 0.15),
                    Color(red: 0.1, green: 0.1, blue: 0.25)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            
            ForEach(skyLanterns) { lantern in
                FloatingLanternView(
                    lantern: lantern,
                    isHovered: hoveredLantern == lantern.id
                )
                .position(lantern.position)
                .onHover { hovering in
                    hoveredLantern = hovering ? lantern.id : nil
                }
                .onTapGesture {
                    if let experience = matchingExperience,
                       ApologyPattern.matches(lantern.visualPattern, experience) {
                        claimLantern(lantern)
                    }
                }
            }
            
            VStack {
                Spacer()
                ForgivenessGarden(reconciledSeeds: gardenSeeds)
                    .frame(height: 200)
                    .background(
                        LinearGradient(
                            colors: [
                                Color(red: 0.1, green: 0.2, blue: 0.1).opacity(0.8),
                                Color(red: 0.05, green: 0.1, blue: 0.05).opacity(0.9)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
            }
            
            if composingApology {
                ApologyComposer(
                    emotions: $currentEmotions,
                    severity: $severity,
                    selectedType: $selectedType,
                    onSend: sendApology
                )
                .frame(width: 400, height: 600)
                .background(Color.black.opacity(0.8))
                .cornerRadius(20)
            }
            
            VStack {
                HStack {
                    Button(action: { composingApology.toggle() }) {
                        Text(composingApology ? "Cancel" : "Compose Apology")
                            .font(.system(size: 14, weight: .medium, design: .rounded))
                            .foregroundColor(.white)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 10)
                            .background(Color.white.opacity(0.2))
                            .cornerRadius(20)
                    }
                    .buttonStyle(.plain)
                    
                    Button(action: generateRandomExperience) {
                        Text("I Was Wronged")
                            .font(.system(size: 14, weight: .medium, design: .rounded))
                            .foregroundColor(.white)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 10)
                            .background(Color.white.opacity(0.2))
                            .cornerRadius(20)
                    }
                    .buttonStyle(.plain)
                    
                    Spacer()
                }
                .padding()
                
                Spacer()
            }
        }
        .onAppear {
            animateLanterns()
        }
        .onDisappear {
            animationTimer?.invalidate()
        }
    }
    
    func sendApology() {
        let pattern = ApologyPattern(
            emotionGradients: currentEmotions,
            severity: severity,
            transgressionType: selectedType
        )
        
        let newLantern = FloatingLantern(
            position: CGPoint(x: 720, y: 800),
            velocity: CGVector(dx: Double.random(in: -20...20), dy: -50),
            visualPattern: pattern
        )
        
        skyLanterns.append(newLantern)
        composingApology = false
        currentEmotions = []
    }
    
    func claimLantern(_ lantern: FloatingLantern) {
        if let index = skyLanterns.firstIndex(where: { $0.id == lantern.id }) {
            withAnimation(.easeInOut(duration: 2)) {
                skyLanterns[index].isClaimed = true
            }
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                let seed = ReconciliationSeed(
                    position: CGPoint(x: lantern.position.x, y: 700),
                    baseColor: lantern.visualPattern.emotionGradients.first?.primary ?? .white,
                    rotation: Double.random(in: 0...360)
                )
                gardenSeeds.append(seed)
                
                skyLanterns.removeAll { $0.id == lantern.id }
            }
        }
    }
    
    func generateRandomExperience() {
        let emotions = emotionPalette.randomElement()!
        matchingExperience = ExperiencePattern(
            emotionGradients: [EmotionGradient(primary: emotions.0, secondary: emotions.1)],
            severity: Double.random(in: 0.3...0.9),
            transgressionType: TransgressionType.allCases.randomElement()!
        )
    }
    
    func animateLanterns() {
        animationTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            for i in skyLanterns.indices {
                skyLanterns[i].position.x += skyLanterns[i].velocity.dx * 0.05
                skyLanterns[i].position.y += skyLanterns[i].velocity.dy * 0.05
                
                if skyLanterns[i].position.y < -50 {
                    skyLanterns[i].position.y = 850
                    skyLanterns[i].position.x = CGFloat.random(in: 100...1340)
                }
            }
        }
    }
}