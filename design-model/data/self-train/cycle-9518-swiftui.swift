struct ContentView: View {
    @State private var leftCharacter: BattleCharacter = BattleCharacter(
        name: "Choice A",
        position: CGPoint(x: 360, y: 450),
        isLeft: true
    )
    
    @State private var rightCharacter: BattleCharacter = BattleCharacter(
        name: "Choice B",
        position: CGPoint(x: 1080, y: 450),
        isLeft: false
    )
    
    @State private var currentInput: String = ""
    @State private var selectedCharacter: UUID?
    @State private var isPro: Bool = true
    @State private var battlePhase: BattlePhase = .setup
    @State private var animationPhase: CGFloat = 0
    @State private var spotlightIntensity: CGFloat = 0
    @State private var crowdVolume: CGFloat = 0
    @State private var podiumHeight: CGFloat = -300
    @State private var winner: UUID?
    @State private var floatingEffects: [FloatingEffect] = []
    @State private var shakeIntensity: CGFloat = 0
    @State private var dramaticPause: Bool = false
    
    enum BattlePhase {
        case setup, fighting, victory
    }
    
    var body: some View {
        ZStack {
            // Dark theatrical background
            RadialGradient(
                colors: [
                    Color(red: 0.05, green: 0.05, blue: 0.08),
                    Color(red: 0.02, green: 0.02, blue: 0.04)
                ],
                center: .center,
                startRadius: 200,
                endRadius: 800
            )
            .ignoresSafeArea()
            
            // Stage floor
            Ellipse()
                .fill(LinearGradient(
                    colors: [
                        Color(red: 0.15, green: 0.12, blue: 0.10),
                        Color(red: 0.08, green: 0.06, blue: 0.05)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                ))
                .frame(width: 1200, height: 200)
                .offset(y: 350)
                .blur(radius: 20)
            
            // Spotlights
            ForEach(0..<3) { i in
                Circle()
                    .fill(RadialGradient(
                        colors: [
                            Color.yellow.opacity(spotlightIntensity * 0.3),
                            Color.clear
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: 300
                    ))
                    .frame(width: 600, height: 600)
                    .offset(
                        x: CGFloat(i - 1) * 400,
                        y: -200
                    )
                    .rotationEffect(.degrees(sin(animationPhase + Double(i)) * 5))
            }
            
            // Characters
            VStack {
                Spacer()
                
                HStack(spacing: 400) {
                    CharacterView(
                        character: leftCharacter,
                        isSelected: selectedCharacter == leftCharacter.id,
                        shakeIntensity: shakeIntensity,
                        animationPhase: animationPhase
                    )
                    .onTapGesture {
                        selectedCharacter = leftCharacter.id
                    }
                    
                    CharacterView(
                        character: rightCharacter,
                        isSelected: selectedCharacter == rightCharacter.id,
                        shakeIntensity: shakeIntensity,
                        animationPhase: animationPhase
                    )
                    .onTapGesture {
                        selectedCharacter = rightCharacter.id
                    }
                }
                .padding(.bottom, 200)
            }
            
            // Floating effects
            ForEach(floatingEffects) { effect in
                Text(effect.text)
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                    .foregroundColor(effect.color)
                    .shadow(color: effect.color, radius: 10)
                    .position(effect.startPosition)
                    .transition(.scale.combined(with: .opacity))
            }
            
            // Victory podium
            if battlePhase == .victory {
                VStack {
                    Spacer()
                    
                    ZStack {
                        RoundedRectangle(cornerRadius: 20)
                            .fill(LinearGradient(
                                colors: [
                                    Color(red: 0.85, green: 0.65, blue: 0.25),
                                    Color(red: 0.95, green: 0.75, blue: 0.35)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ))
                            .frame(width: 300, height: 200)
                            .overlay(
                                RoundedRectangle(cornerRadius: 20)
                                    .stroke(Color.yellow, lineWidth: 3)
                            )
                        
                        Text("WINNER")
                            .font(.system(size: 48, weight: .black, design: .rounded))
                            .foregroundColor(.white)
                            .shadow(color: .black, radius: 10, x: 0, y: 5)
                    }
                    .offset(y: podiumHeight)
                }
            }
            
            // Control panel
            if battlePhase == .setup {
                VStack {
                    Spacer()
                    
                    ControlPanel(
                        currentInput: $currentInput,
                        isPro: $isPro,
                        onSubmit: addArgument
                    )
                    .padding(.bottom, 40)
                }
            }
        }
        .onAppear {
            withAnimation(Animation.linear(duration: 2).repeatForever(autoreverses: false)) {
                animationPhase = .pi * 2
            }
            withAnimation(.easeInOut(duration: 1)) {
                spotlightIntensity = 1.0
            }
        }
    }
    
    func addArgument() {
        guard !currentInput.isEmpty else { return }
        
        if selectedCharacter == leftCharacter.id {
            leftCharacter.arguments.append(currentInput)
        } else if selectedCharacter == rightCharacter.id {
            rightCharacter.arguments.append(currentInput)
        }
        
        currentInput = ""
    }
}

struct CharacterView: View {
    let character: BattleCharacter
    let isSelected: Bool
    let shakeIntensity: CGFloat
    let animationPhase: CGFloat
    
    var body: some View {
        VStack {
            ZStack {
                Circle()
                    .fill(LinearGradient(
                        colors: [
                            character.isLeft ? Color.blue : Color.red,
                            character.isLeft ? Color.blue.opacity(0.6) : Color.red.opacity(0.6)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ))
                    .frame(width: 120, height: 120)
                    .overlay(
                        Circle()
                            .stroke(isSelected ? Color.yellow : Color.clear, lineWidth: 4)
                            .scaleEffect(isSelected ? 1.2 : 1.0)
                    )
                
                Text(String(character.name.prefix(1)))
                    .font(.system(size: 48, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
            }
            .offset(x: sin(animationPhase + (character.isLeft ? 0 : .pi)) * 5 + shakeIntensity)
            
            Text(character.name)
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundColor(.white)
                .padding(.top, 10)
            
            // Health bar
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.gray.opacity(0.3))
                    .frame(width: 150, height: 20)
                
                RoundedRectangle(cornerRadius: 10)
                    .fill(LinearGradient(
                        colors: [Color.green, Color.yellow],
                        startPoint: .leading,
                        endPoint: .trailing
                    ))
                    .frame(width: 150 * character.health / 100, height: 20)
            }
            .padding(.top, 5)
        }
    }
}

struct ControlPanel: View {
    @Binding var currentInput: String
    @Binding var isPro: Bool
    let onSubmit: () -> Void
    
    var body: some View {
        VStack(spacing: 20) {
            HStack {
                TextField("Enter argument...", text: $currentInput)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                    .frame(width: 400)
                
                Button(action: onSubmit) {
                    Text("Add Argument")
                        .foregroundColor(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(Color.blue)
                        .cornerRadius(10)
                }
                
                Toggle("Pro", isOn: $isPro)
                    .toggleStyle(SwitchToggleStyle())
                    .frame(width: 100)
            }
            .padding()
            .background(Color.black.opacity(0.8))
            .cornerRadius(15)
        }
    }
}