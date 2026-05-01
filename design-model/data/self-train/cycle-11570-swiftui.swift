struct ContentView: View {
    @State private var selectedIngredients: [IngredientData] = []
    @State private var mixtureParticles: [MixtureParticle] = []
    @State private var anxietyLevel: Double = 0.3
    @State private var socialBattery: Double = 0.7
    @State private var isDragging: Bool = false
    @State private var draggedIngredient: IngredientData?
    @State private var dropPosition: CGPoint = .zero
    @State private var conversationFlow: [ConversationNode] = []
    @State private var mixtureName: String = ""
    @State private var isMixing: Bool = false
    
    let ingredients: [IngredientData] = [
        IngredientData(name: "Introversion Extract", color: Color(red: 0.2, green: 0.3, blue: 0.5), viscosity: 0.8, category: "core", description: "Concentrated quiet energy"),
        IngredientData(name: "Small Talk Base", color: Color(red: 0.9, green: 0.7, blue: 0.3), viscosity: 0.3, category: "base", description: "Light conversational foundation"),
        IngredientData(name: "Deep Connection Essence", color: Color(red: 0.4, green: 0.2, blue: 0.6), viscosity: 0.9, category: "essence", description: "Meaningful dialogue catalyst"),
        IngredientData(name: "Humor Tincture", color: Color(red: 0.9, green: 0.4, blue: 0.5), viscosity: 0.4, category: "modifier", description: "Lightness and wit infusion"),
        IngredientData(name: "Empathy Distillate", color: Color(red: 0.3, green: 0.7, blue: 0.6), viscosity: 0.6, category: "essence", description: "Understanding amplifier"),
        IngredientData(name: "Boundary Setting Crystals", color: Color(red: 0.8, green: 0.2, blue: 0.3), viscosity: 0.7, category: "stabilizer", description: "Personal space protector"),
        IngredientData(name: "Active Listening Brew", color: Color(red: 0.5, green: 0.6, blue: 0.8), viscosity: 0.5, category: "base", description: "Attention enhancer"),
        IngredientData(name: "Confidence Vapor", color: Color(red: 0.9, green: 0.8, blue: 0.2), viscosity: 0.2, category: "modifier", description: "Self-assurance mist")
    ]
    
    var body: some View {
        HStack(spacing: 0) {
            // Ingredient shelf
            VStack(spacing: 0) {
                Text("SOCIAL ELEMENTS")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundColor(Color(red: 0.3, green: 0.3, blue: 0.3))
                    .padding(.top, 20)
                
                ScrollView {
                    VStack(spacing: 12) {
                        ForEach(ingredients) { ingredient in
                            IngredientBottle(ingredient: ingredient, isDragging: isDragging && draggedIngredient?.id == ingredient.id)
                                .onDrag {
                                    draggedIngredient = ingredient
                                    isDragging = true
                                    return NSItemProvider(object: ingredient.name as NSString)
                                }
                        }
                    }
                    .padding(20)
                }
            }
            .frame(width: 280)
            .background(Color(red: 0.97, green: 0.97, blue: 0.96))
            
            // Mixing area
            VStack(spacing: 0) {
                // Title bar
                HStack {
                    TextField("Name your mixture...", text: $mixtureName)
                        .textFieldStyle(.plain)
                        .font(.system(size: 24, weight: .light, design: .serif))
                        .foregroundColor(Color(red: 0.2, green: 0.2, blue: 0.2))
                    
                    Spacer()
                    
                    Button(action: { exportMixture() }) {
                        Text("SERVE")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundColor(.white)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 8)
                            .background(Color(red: 0.2, green: 0.2, blue: 0.2))
                            .clipShape(Capsule())
                    }
                    .disabled(selectedIngredients.isEmpty)
                }
                .padding(30)
                
                // Mixing vessel
                ZStack {
                    MixingVessel(particles: mixtureParticles, conversationFlow: conversationFlow)
                        .onDrop(of: [.text], isTargeted: nil) { providers in
                            if let ingredient = draggedIngredient {
                                addIngredient(ingredient)
                            }
                            isDragging = false
                            return true
                        }
                    
                    if selectedIngredients.isEmpty {
                        VStack(spacing: 16) {
                            Image(systemName: "drop.circle")
                                .font(.system(size: 48))
                                .foregroundColor(Color(red: 0.8, green: 0.8, blue: 0.8))
                            
                            Text("Drop ingredients here to begin mixing")
                                .font(.system(size: 14, weight: .regular, design: .default))
                                .foregroundColor(Color(red: 0.6, green: 0.6, blue: 0.6))
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                
                // Real-time adjusters
                HStack(spacing: 40) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("ANXIETY LEVEL")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundColor(Color(red: 0.4, green: 0.4, blue: 0.4))
                        
                        HStack {
                            Slider(value: $anxietyLevel, in: 0...1)
                                .tint(Color(red: 0.8, green: 0.3, blue: 0.3))
                            
                            Text("\(Int(anxietyLevel * 100))%")
                                .font(.system(size: 12, weight: .medium, design: .monospaced))
                                .foregroundColor(Color(red: 0.5, green: 0.5, blue: 0.5))
                                .frame(width: 40)
                        }
                    }
                    .frame(width: 200)
                    
                    VStack(alignment: .leading, spacing: 8) {
                        Text("SOCIAL BATTERY")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundColor(Color(red: 0.4, green: 0.4, blue: 0.4))
                        
                        HStack {
                            Slider(value: $socialBattery, in: 0...1)
                                .tint(Color(red: 0.3, green: 0.7, blue: 0.5))
                            
                            Text("\(Int(socialBattery * 100))%")
                                .font(.system(size: 12, weight: .medium, design: .monospaced))
                                .foregroundColor(Color(red: 0.5, green: 0.5, blue: 0.5))
                                .frame(width: 40)
                        }
                    }
                    .frame(width: 200)
                }
                .padding(30)
            }
            .frame(maxWidth: .infinity)
            .background(Color.white)
        }
        .frame(minWidth: 1200, minHeight: 800)
    }
    
    func addIngredient(_ ingredient: IngredientData) {
        selectedIngredients.append(ingredient)
        
        // Add particles
        for _ in 0..<Int(ingredient.viscosity * 20) {
            let particle = MixtureParticle(
                position: CGPoint(x: CGFloat.random(in: 100...500), y: CGFloat.random(in: 100...300)),
                velocity: CGVector(dx: CGFloat.random(in: -2...2), dy: CGFloat.random(in: -2...2)),
                color: ingredient.color,
                size: CGFloat.random(in: 5...15)
            )
            mixtureParticles.append(particle)
        }
        
        // Add conversation nodes
        if ingredient.category == "essence" || ingredient.category == "base" {
            let node = ConversationNode(
                text: generateConversationText(for: ingredient),
                depth: Int.random(in: 1...3),
                connection: Double.random(in: 0.3...0.9)
            )
            conversationFlow.append(node)
        }
        
        startMixing()
    }
    
    func generateConversationText(for ingredient: IngredientData) -> String {
        let texts = [
            "Introversion Extract": ["...quiet moments...", "inner reflection", "solitude"],
            "Small Talk Base": ["How's the weather?", "Nice to meet you", "What do you do?"],
            "Deep Connection Essence": ["Tell me more about...", "I understand how you feel", "What matters to you?"],
            "Active Listening Brew": ["I hear you", "Go on...", "That's interesting"]
        ]
        
        return texts[ingredient.name]?.randomElement() ?? "..."
    }
    
    func startMixing() {
        isMixing = true
        // Animation logic would go here
    }
    
    func exportMixture() {
        // Export logic would go here
    }
}