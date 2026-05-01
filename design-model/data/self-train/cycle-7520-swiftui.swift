struct ContentView: View {
    @State private var fragments: [RecipeFragment] = [
        RecipeFragment(content: "2 cups flour", type: .handwrittenNote, position: CGPoint(x: 100, y: 200), rotation: -15, opacity: 0.8),
        RecipeFragment(content: "pinch of love", type: .handwrittenNote, position: CGPoint(x: 1300, y: 150), rotation: 20, opacity: 0.7),
        RecipeFragment(content: "butter (melted)", type: .stainedCard, position: CGPoint(x: 150, y: 700), rotation: -5, opacity: 0.9),
        RecipeFragment(content: "[faded photo of hands kneading]", type: .photograph, position: CGPoint(x: 1250, y: 650), rotation: 12, opacity: 0.6),
        RecipeFragment(content: "sugar to taste", type: .stainedCard, position: CGPoint(x: 200, y: 450), rotation: -20, opacity: 0.75),
        RecipeFragment(content: "bake until golden", type: .handwrittenNote, position: CGPoint(x: 1200, y: 400), rotation: 8, opacity: 0.85)
    ]
    
    @State private var potTemperature: Double = 0
    @State private var revealedText: String = ""
    @State private var isCorrectCombination: Bool = false
    @State private var unlockedRecipes: [String] = []
    @State private var currentVignette: String?
    @State private var draggedFragment: RecipeFragment?
    @State private var potBounds = CGRect(x: 520, y: 250, width: 400, height: 400)
    
    var body: some View {
        ZStack {
            // Aged paper background
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.95, green: 0.92, blue: 0.88),
                            Color(red: 0.92, green: 0.89, blue: 0.85)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    // Tea stains and age marks
                    ZStack {
                        Circle()
                            .fill(Color(red: 0.8, green: 0.7, blue: 0.6).opacity(0.1))
                            .frame(width: 200)
                            .position(x: 300, y: 500)
                            .blur(radius: 40)
                        
                        Circle()
                            .fill(Color(red: 0.75, green: 0.65, blue: 0.55).opacity(0.08))
                            .frame(width: 300)
                            .position(x: 1100, y: 200)
                            .blur(radius: 50)
                    }
                )
            
            // Memory vessel
            MemoryVessel(
                fragments: $fragments,
                potTemperature: $potTemperature,
                revealedText: $revealedText,
                isCorrectCombination: $isCorrectCombination
            )
            .position(x: 720, y: 450)
            
            // Recipe fragments
            ForEach(fragments.indices, id: \.self) { index in
                if !fragments[index].isPlaced {
                    FragmentView(fragment: fragments[index])
                        .position(fragments[index].position)
                        .rotationEffect(.degrees(fragments[index].rotation))
                        .opacity(fragments[index].opacity)
                        .onDrag {
                            draggedFragment = fragments[index]
                            return NSItemProvider(object: String(index) as NSString)
                        }
                }
            }
            
            // Drop zone overlay (invisible)
            Rectangle()
                .fill(Color.clear)
                .frame(width: 400, height: 400)
                .position(x: 720, y: 450)
                .onDrop(of: [.plainText], delegate: DropDelegate(
                    fragments: $fragments,
                    potTemperature: $potTemperature,
                    revealedText: $revealedText,
                    isCorrectCombination: $isCorrectCombination,
                    currentVignette: $currentVignette
                ))
            
            // Ghostly vignette overlay
            if let vignette = currentVignette {
                GhostlyVignette(recipeName: vignette)
                    .position(x: 720, y: 450)
            }
            
            // Title
            Text("Grandmother's Lost Recipes")
                .font(.system(size: 42, weight: .ultraLight, design: .serif))
                .foregroundColor(Color(red: 0.3, green: 0.25, blue: 0.2))
                .position(x: 720, y: 60)
        }
        .frame(width: 1440, height: 900)
    }
}

struct FragmentView: View {
    let fragment: RecipeFragment
    
    var body: some View {
        ZStack {
            switch fragment.type {
            case .handwrittenNote:
                RoundedRectangle(cornerRadius: 3)
                    .fill(Color(red: 0.98, green: 0.96, blue: 0.92))
                    .frame(width: 180, height: 60)
                    .overlay(
                        Text(fragment.content)
                            .font(.system(size: 16, weight: .light, design: .serif))
                            .foregroundColor(Color(red: 0.2, green: 0.15, blue: 0.1))
                            .italic()
                    )
                    .shadow(color: Color.black.opacity(0.1), radius: 2, x: 1, y: 1)
                
            case .stainedCard:
                RoundedRectangle(cornerRadius: 5)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(red: 0.94, green: 0.90, blue: 0.84),
                                Color(red: 0.88, green: 0.84, blue: 0.78)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 200, height: 80)
                    .overlay(
                        Text(fragment.content)
                            .font(.system(size: 18, weight: .regular, design: .serif))
                            .foregroundColor(Color(red: 0.3, green: 0.25, blue: 0.2))
                    )
                    .shadow(color: Color.black.opacity(0.15), radius: 3, x: 2, y: 2)
                
            case .photograph:
                Rectangle()
                    .fill(Color(red: 0.85, green: 0.82, blue: 0.78))
                    .frame(width: 220, height: 100)
                    .overlay(
                        Text(fragment.content)
                            .font(.system(size: 14, weight: .light, design: .serif))
                            .foregroundColor(Color(red: 0.4, green: 0.35, blue: 0.3))
                            .multilineTextAlignment(.center)
                    )
                    .overlay(
                        Rectangle()
                            .stroke(Color.white, lineWidth: 4)
                            .padding(4)
                    )
                    .shadow(color: Color.black.opacity(0.2), radius: 4, x: 2, y: 2)
            }
        }
    }
}

struct MemoryVessel: View {
    @Binding var fragments: [RecipeFragment]
    @Binding var potTemperature: Double
    @Binding var revealedText: String
    @Binding var isCorrectCombination: Bool
    
    var body: some View {
        ZStack {
            // Pot
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(red: 0.25, green: 0.20, blue: 0.15),
                            Color(red: 0.15, green: 0.12, blue: 0.10)
                        ],
                        center: .center,
                        startRadius: 100,
                        endRadius: 200
                    )
                )
                .frame(width: 400, height: 400)
                .overlay(
                    Circle()
                        .stroke(Color(red: 0.1, green: 0.08, blue: 0.06), lineWidth: 8)
                )
            
            // Mystical glow effect
            if potTemperature > 0 {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color.purple.opacity(potTemperature / 100),
                                Color.clear
                            ],
                            center: .center,
                            startRadius: 50,
                            endRadius: 200
                        )
                    )
                    .frame(width: 450, height: 450)
                    .blur(radius: 20)
            }
            
            // Revealed text
            if !revealedText.isEmpty {
                Text(revealedText)
                    .font(.system(size: 24, weight: .light, design: .serif))
                    .foregroundColor(Color.white.opacity(0.8))
                    .multilineTextAlignment(.center)
                    .frame(width: 300)
                    .transition(.opacity)
            }
        }
    }
}

struct GhostlyVignette: View {
    let recipeName: String
    @State private var opacity: Double = 0
    
    var body: some View {
        Text(recipeName)
            .font(.system(size: 36, weight: .ultraLight, design: .serif))
            .foregroundColor(Color(red: 0.6, green: 0.5, blue: 0.7))
            .opacity(opacity)
            .onAppear {
                withAnimation(.easeIn(duration: 2)) {
                    opacity = 0.6
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                    withAnimation(.easeOut(duration: 1)) {
                        opacity = 0
                    }
                }
            }
    }
}

struct DropDelegate: DropDelegate {
    @Binding var fragments: [RecipeFragment]
    @Binding var potTemperature: Double
    @Binding var revealedText: String
    @Binding var isCorrectCombination: Bool
    @Binding var currentVignette: String?
    
    func performDrop(info: DropInfo) -> Bool {
        guard let provider = info.itemProviders(for: [.plainText]).first else {
            return false
        }
        
        provider.loadObject(ofClass: NSString.self) { item, _ in
            if let indexString = item as? String,
               let index = Int(indexString),
               index < fragments.count {
                DispatchQueue.main.async {
                    fragments[index].isPlaced = true
                    
                    // Update pot temperature
                    withAnimation(.easeIn(duration: 0.5)) {
                        potTemperature = min(100, potTemperature + 20)
                    }
                    
                    // Check combinations
                    checkRecipeCombinations()
                }
            }
        }
        
        return true
    }
    
    func checkRecipeCombinations() {
        let placedFragments = fragments.filter { $0.isPlaced }
        let placedContents = placedFragments.map { $0.content }
        
        if placedContents.contains("2 cups flour") && placedContents.contains("butter (melted)") {
            revealedText = "Grandmother's Secret Bread"
            currentVignette = "The warmth of her kitchen..."
        } else if placedContents.contains("sugar to taste") && placedContents.contains("pinch of love") {
            revealedText = "Memory Cookies"
            currentVignette = "Sunday afternoons together..."
        } else if placedFragments.count >= 4 {
            revealedText = "The Complete Collection"
            currentVignette = "All memories restored..."
        }
    }
}