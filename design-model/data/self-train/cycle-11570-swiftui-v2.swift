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
    @State private var mixAnimation: Bool = false
    
    let ingredients: [IngredientData] = [
        IngredientData(name: "Introversion Extract", color: Color(#colorLiteral(red: 0.3843137255, green: 0.4470588235, blue: 0.6431372549, alpha: 1)), viscosity: 0.8, category: "core", description: "Concentrated quiet energy"),
        IngredientData(name: "Small Talk Base", color: Color(#colorLiteral(red: 0.9607843137, green: 0.7607843137, blue: 0.2549019608, alpha: 1)), viscosity: 0.3, category: "base", description: "Light conversational foundation"),
        IngredientData(name: "Deep Connection Essence", color: Color(#colorLiteral(red: 0.5529411765, green: 0.3921568627, blue: 0.7647058824, alpha: 1)), viscosity: 0.9, category: "essence", description: "Meaningful dialogue catalyst"),
        IngredientData(name: "Humor Tincture", color: Color(#colorLiteral(red: 0.9568627451, green: 0.5254901961, blue: 0.5450980392, alpha: 1)), viscosity: 0.4, category: "modifier", description: "Lightness and wit infusion")
    ]
    
    var body: some View {
        HStack(spacing: 0) {
            // Ingredient shelf
            VStack(spacing: 0) {
                Text("Social Elements")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.secondary)
                    .padding(.top, 24)
                    .padding(.bottom, 16)
                
                ScrollView {
                    VStack(spacing: 16) {
                        ForEach(ingredients) { ingredient in
                            IngredientBottle(ingredient: ingredient, isDragging: isDragging && draggedIngredient?.id == ingredient.id)
                                .onDrag {
                                    withAnimation(.easeInOut(duration: 0.2)) {
                                        draggedIngredient = ingredient
                                        isDragging = true
                                    }
                                    return NSItemProvider(object: ingredient.name as NSString)
                                }
                                .scaleEffect(isDragging && draggedIngredient?.id == ingredient.id ? 0.9 : 1.0)
                                .animation(.spring(response: 0.4, dampingFraction: 0.6), value: isDragging)
                        }
                    }
                    .padding(20)
                }
            }
            .frame(width: 280)
            .background(Color(UIColor.secondarySystemBackground))
            
            // Mixing area
            VStack(spacing: 0) {
                // Title bar
                HStack {
                    TextField("Name your mixture...", text: $mixtureName)
                        .textFieldStyle(.plain)
                        .font(.system(size: 24, weight: .medium))
                        .foregroundColor(.primary)
                    
                    Spacer()
                    
                    Button(action: { 
                        withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
                            exportMixture()
                        }
                    }) {
                        Text("Serve")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 24)
                            .padding(.vertical, 10)
                            .background(selectedIngredients.isEmpty ? Color.gray : Color.accentColor)
                            .clipShape(Capsule())
                    }
                    .disabled(selectedIngredients.isEmpty)
                    .animation(.easeInOut, value: selectedIngredients.isEmpty)
                }
                .padding(30)
                
                // Mixing vessel
                ZStack {
                    MixingVessel(particles: mixtureParticles, conversationFlow: conversationFlow, isAnimating: mixAnimation)
                        .onDrop(of: [.text], isTargeted: nil) { providers in
                            if let ingredient = draggedIngredient {
                                withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                                    addIngredient(ingredient)
                                    mixAnimation.toggle()
                                }
                            }
                            withAnimation(.easeOut(duration: 0.2)) {
                                isDragging = false
                            }
                            return true
                        }
                    
                    if selectedIngredients.isEmpty {
                        VStack(spacing: 20) {
                            Image(systemName: "drop.circle")
                                .font(.system(size: 48))
                                .foregroundColor(.secondary)
                                .opacity(0.5)
                            
                            Text("Drag ingredients here to mix")
                                .font(.system(size: 16))
                                .foregroundColor(.secondary)
                        }
                        .transition(.opacity)
                    }
                }
                
                // Metrics panel
                HStack(spacing: 40) {
                    MetricGauge(title: "Social Battery", value: socialBattery, color: .green)
                    MetricGauge(title: "Comfort Level", value: 1.0 - anxietyLevel, color: .blue)
                }
                .padding(30)
                .background(Color(UIColor.secondarySystemBackground))
            }
            .background(Color(UIColor.systemBackground))
        }
    }
    
    func addIngredient(_ ingredient: IngredientData) {
        selectedIngredients.append(ingredient)
        generateParticles(for: ingredient)
        updateMetrics()
    }
    
    func generateParticles(for ingredient: IngredientData) {
        for _ in 0..<20 {
            let particle = MixtureParticle(
                position: CGPoint(x: CGFloat.random(in: 100...300), y: CGFloat.random(in: 100...300)),
                velocity: CGPoint(x: CGFloat.random(in: -50...50), y: CGFloat.random(in: -50...50)),
                color: ingredient.color,
                size: CGFloat.random(in: 4...12),
                ingredient: ingredient
            )
            mixtureParticles.append(particle)
        }
    }
    
    func updateMetrics() {
        withAnimation(.easeInOut(duration: 0.8)) {
            socialBattery = min(1.0, socialBattery + Double.random(in: -0.1...0.2))
            anxietyLevel = max(0.0, anxietyLevel + Double.random(in: -0.15...0.1))
        }
    }
    
    func exportMixture() {
        // Export functionality
    }
}

struct IngredientBottle: View {
    let ingredient: IngredientData
    let isDragging: Bool
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Circle()
                    .fill(ingredient.color)
                    .frame(width: 40, height: 40)
                    .overlay(
                        Circle()
                            .stroke(Color.white.opacity(0.3), lineWidth: 2)
                    )
                    .shadow(color: ingredient.color.opacity(0.3), radius: 8, y: 4)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(ingredient.name)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.primary)
                    
                    Text(ingredient.description)
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                }
                
                Spacer()
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(UIColor.tertiarySystemBackground))
                    .shadow(color: Color.black.opacity(0.05), radius: 4, y: 2)
            )
        }
        .opacity(isDragging ? 0.5 : 1.0)
    }
}

struct MixingVessel: View {
    let particles: [MixtureParticle]
    let conversationFlow: [ConversationNode]
    let isAnimating: Bool
    
    var body: some View {
        GeometryReader { geo in
            ZStack {
                // Background gradient based on mixed colors
                LinearGradient(
                    gradient: Gradient(colors: particles.isEmpty ? [Color(UIColor.systemGray6)] : particles.map { $0.color }.unique()),
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .opacity(0.1)
                .clipShape(Circle())
                .padding(40)
                
                // Animated particles
                ForEach(particles) { particle in
                    Circle()
                        .fill(particle.color)
                        .frame(width: particle.size, height: particle.size)
                        .position(particle.position)
                        .blur(radius: 1)
                        .opacity(0.8)
                        .animation(
                            Animation.linear(duration: Double.random(in: 2...4))
                                .repeatForever(autoreverses: true),
                            value: isAnimating
                        )
                }
                
                // Mixing effect overlay
                if !particles.isEmpty {
                    Circle()
                        .stroke(
                            LinearGradient(
                                gradient: Gradient(colors: [.white.opacity(0.3), .clear]),
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 2
                        )
                        .padding(40)
                        .rotationEffect(.degrees(isAnimating ? 360 : 0))
                        .animation(
                            Animation.linear(duration: 8)
                                .repeatForever(autoreverses: false),
                            value: isAnimating
                        )
                }
            }
        }
    }
}

struct MetricGauge: View {
    let title: String
    let value: Double
    let color: Color
    
    var body: some View {
        VStack(spacing: 8) {
            Text(title)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.secondary)
            
            ZStack {
                Circle()
                    .stroke(Color.gray.opacity(0.2), lineWidth: 8)
                
                Circle()
                    .trim(from: 0, to: value)
                    .stroke(color, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.spring(response: 0.6, dampingFraction: 0.8), value: value)
                
                Text("\(Int(value * 100))%")
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .foregroundColor(.primary)
            }
            .frame(width: 80, height: 80)
        }
    }
}

struct IngredientData: Identifiable {
    let id = UUID()
    let name: String
    let color: Color
    let viscosity: Double
    let category: String
    let description: String
}

struct MixtureParticle: Identifiable {
    let id = UUID()
    var position: CGPoint
    var velocity: CGPoint
    let color: Color
    let size: CGFloat
    let ingredient: IngredientData
}

struct ConversationNode: Identifiable {
    let id = UUID()
    let content: String
    let depth: Int
    let connections: [UUID]
}

extension Array where Element == Color {
    func unique() -> [Color] {
        var seen = Set<String>()
        return filter { color in
            let key = "\(color)"
            return seen.insert(key).inserted
        }
    }
}