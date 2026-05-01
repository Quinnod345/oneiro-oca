struct ContentView: View {
    @State private var fragments: [RecipeFragment] = [
        RecipeFragment(content: "2 cups flour", type: .handwrittenNote, rotation: -15, opacity: 0.8),
        RecipeFragment(content: "pinch of love", type: .handwrittenNote, rotation: 20, opacity: 0.7),
        RecipeFragment(content: "butter (melted)", type: .stainedCard, rotation: -5, opacity: 0.9),
        RecipeFragment(content: "[faded photo of hands kneading]", type: .photograph, rotation: 12, opacity: 0.6),
        RecipeFragment(content: "sugar to taste", type: .stainedCard, rotation: -20, opacity: 0.75),
        RecipeFragment(content: "bake until golden", type: .handwrittenNote, rotation: 8, opacity: 0.85)
    ]
    
    @State private var potTemperature: Double = 0
    @State private var revealedText: String = ""
    @State private var isCorrectCombination: Bool = false
    @State private var unlockedRecipes: [String] = []
    @State private var currentVignette: String?
    @State private var draggedFragment: RecipeFragment?
    @State private var hoveredFragment: RecipeFragment?
    @State private var isDraggingOverPot: Bool = false
    
    var body: some View {
        GeometryReader { geometry in
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
                                .frame(width: geometry.size.width * 0.15)
                                .position(x: geometry.size.width * 0.2, y: geometry.size.height * 0.6)
                                .blur(radius: 40)
                            
                            Circle()
                                .fill(Color(red: 0.75, green: 0.65, blue: 0.55).opacity(0.08))
                                .frame(width: geometry.size.width * 0.2)
                                .position(x: geometry.size.width * 0.8, y: geometry.size.height * 0.2)
                                .blur(radius: 50)
                        }
                    )
                
                VStack(spacing: 0) {
                    // Title
                    Text("Grandmother's Lost Recipes")
                        .font(.system(size: min(geometry.size.width * 0.04, 42), weight: .ultraLight, design: .serif))
                        .foregroundColor(Color(red: 0.3, green: 0.25, blue: 0.2))
                        .padding(.top, 40)
                        .padding(.bottom, 30)
                    
                    // Main content area
                    HStack(spacing: 40) {
                        // Left fragments column
                        VStack(spacing: 30) {
                            ForEach(Array(fragments.enumerated().filter { $0.offset < 3 }), id: \.offset) { index, fragment in
                                if !fragment.isPlaced {
                                    FragmentView(
                                        fragment: fragment,
                                        isHovered: hoveredFragment?.id == fragment.id,
                                        isDragging: draggedFragment?.id == fragment.id
                                    )
                                    .rotationEffect(.degrees(fragment.rotation))
                                    .opacity(fragment.opacity)
                                    .scaleEffect(hoveredFragment?.id == fragment.id ? 1.05 : 1.0)
                                    .animation(.easeInOut(duration: 0.2), value: hoveredFragment?.id == fragment.id)
                                    .onHover { isHovered in
                                        hoveredFragment = isHovered ? fragment : nil
                                    }
                                    .onDrag {
                                        draggedFragment = fragment
                                        return NSItemProvider(object: fragment.id.uuidString as NSString)
                                    }
                                    .transition(.asymmetric(
                                        insertion: .scale.combined(with: .opacity),
                                        removal: .scale(scale: 0.8).combined(with: .opacity)
                                    ))
                                }
                            }
                            Spacer()
                        }
                        .frame(width: geometry.size.width * 0.25)
                        .padding(.leading, 40)
                        
                        // Center area - Memory vessel
                        ZStack {
                            MemoryVessel(
                                fragments: $fragments,
                                potTemperature: $potTemperature,
                                revealedText: $revealedText,
                                isCorrectCombination: $isCorrectCombination,
                                isDraggingOver: isDraggingOverPot
                            )
                            .frame(width: min(geometry.size.width * 0.3, 400), height: min(geometry.size.width * 0.3, 400))
                            .scaleEffect(isDraggingOverPot ? 1.05 : 1.0)
                            .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isDraggingOverPot)
                            .onDrop(of: [.plainText], delegate: DropDelegate(
                                fragments: $fragments,
                                potTemperature: $potTemperature,
                                revealedText: $revealedText,
                                isCorrectCombination: $isCorrectCombination,
                                currentVignette: $currentVignette,
                                isDraggingOverPot: $isDraggingOverPot
                            ))
                            
                            // Ghostly vignette overlay
                            if let vignette = currentVignette {
                                GhostlyVignette(recipeName: vignette)
                                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
                            }
                        }
                        .frame(maxWidth: .infinity)
                        
                        // Right fragments column
                        VStack(spacing: 30) {
                            ForEach(Array(fragments.enumerated().filter { $0.offset >= 3 }), id: \.offset) { index, fragment in
                                if !fragment.isPlaced {
                                    FragmentView(
                                        fragment: fragment,
                                        isHovered: hoveredFragment?.id == fragment.id,
                                        isDragging: draggedFragment?.id == fragment.id
                                    )
                                    .rotationEffect(.degrees(fragment.rotation))
                                    .opacity(fragment.opacity)
                                    .scaleEffect(hoveredFragment?.id == fragment.id ? 1.05 : 1.0)
                                    .animation(.easeInOut(duration: 0.2), value: hoveredFragment?.id == fragment.id)
                                    .onHover { isHovered in
                                        hoveredFragment = isHovered ? fragment : nil
                                    }
                                    .onDrag {
                                        draggedFragment = fragment
                                        return NSItemProvider(object: fragment.id.uuidString as NSString)
                                    }
                                    .transition(.asymmetric(
                                        insertion: .scale.combined(with: .opacity),
                                        removal: .scale(scale: 0.8).combined(with: .opacity)
                                    ))
                                }
                            }
                            Spacer()
                        }
                        .frame(width: geometry.size.width * 0.25)
                        .padding(.trailing, 40)
                    }
                    .frame(maxHeight: .infinity)
                    .padding(.bottom, 40)
                }
                .animation(.spring(response: 0.5, dampingFraction: 0.8), value: fragments.map { $0.isPlaced })
            }
        }
    }
}

struct RecipeFragment: Identifiable, Equatable {
    let id = UUID()
    let content: String
    let type: FragmentType
    let rotation: Double
    let opacity: Double
    var isPlaced: Bool = false
    
    enum FragmentType {
        case handwrittenNote, stainedCard, photograph
    }
}

struct FragmentView: View {
    let fragment: RecipeFragment
    let isHovered: Bool
    let isDragging: Bool
    
    var body: some View {
        ZStack {
            switch fragment.type {
            case .handwrittenNote:
                RoundedRectangle(cornerRadius: 3)
                    .fill(Color(red: 0.98, green: 0.96, blue: 0.92))
                    .overlay(
                        RoundedRectangle(cornerRadius: 3)
                            .stroke(Color(red: 0.8, green: 0.75, blue: 0.7), lineWidth: 0.5)
                    )
                    .shadow(color: Color.black.opacity(isHovered ? 0.2 : 0.1), radius: isHovered ? 8 : 4, x: 2, y: 2)
                
            case .stainedCard:
                RoundedRectangle(cornerRadius: 5)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(red: 0.95, green: 0.93, blue: 0.89),
                                Color(red: 0.93, green: 0.90, blue: 0.86)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .overlay(
                        Circle()
                            .fill(Color(red: 0.8, green: 0.7, blue: 0.6).opacity(0.1))
                            .frame(width: 60)
                            .offset(x: 20, y: -10)
                            .blur(radius: 15)
                    )
                    .shadow(color: Color.black.opacity(isHovered ? 0.2 : 0.1), radius: isHovered ? 8 : 4, x: 2, y: 2)
                
            case .photograph:
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color(red: 0.9, green: 0.88, blue: 0.85))
                    .overlay(
                        RoundedRectangle(cornerRadius: 2)
                            .stroke(Color.white, lineWidth: 3)
                            .padding(3)
                    )
                    .shadow(color: Color.black.opacity(isHovered ? 0.25 : 0.15), radius: isHovered ? 10 : 5, x: 3, y: 3)
            }
            
            Text(fragment.content)
                .font(fragment.type == .handwrittenNote ? .system(size: 16, weight: .light, design: .serif) : .system(size: 14, design: .serif))
                .foregroundColor(Color(red: 0.3, green: 0.25, blue: 0.2).opacity(fragment.type == .photograph ? 0.6 : 0.8))
                .padding(.horizontal, 20)
                .padding(.vertical, 15)
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
        .frame(width: 200, height: 80)
        .opacity(isDragging ? 0.5 : 1.0)
        .animation(.easeInOut(duration: 0.2), value: isDragging)
    }
}

struct MemoryVessel: View {
    @Binding var fragments: [RecipeFragment]
    @Binding var potTemperature: Double
    @Binding var revealedText: String
    @Binding var isCorrectCombination: Bool
    let isDraggingOver: Bool
    
    var body: some View {
        ZStack {
            // Vessel shape
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(red: 0.4, green: 0.35, blue: 0.3).opacity(0.8),
                            Color(red: 0.3, green: 0.25, blue: 0.2).opacity(0.9)
                        ],
                        center: .center,
                        startRadius: 50,
                        endRadius: 150
                    )
                )
                .overlay(
                    Circle()
                        .stroke(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.6, green: 0.55, blue: 0.5),
                                    Color(red: 0.4, green: 0.35, blue: 0.3)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: isDraggingOver ? 4 : 2
                        )
                )
                .shadow(color: Color.black.opacity(0.3), radius: 20, x: 0, y: 10)
            
            // Inner glow when active
            if potTemperature > 0 {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(red: 1.0, green: 0.8, blue: 0.6).opacity(potTemperature / 100),
                                Color.clear
                            ],
                            center: .center,
                            startRadius: 0,
                            endRadius: 100
                        )
                    )
                    .blur(radius: 20)
                    .animation(.easeInOut(duration: 1.0), value: potTemperature)
            }
            
            // Revealed text
            if !revealedText.isEmpty {
                Text(revealedText)
                    .font(.system(size: 18, weight: .light, design: .serif))
                    .foregroundColor(Color.white.opacity(0.9))
                    .multilineTextAlignment(.center)
                    .padding(40)
                    .transition(.opacity.combined(with: .scale(scale: 0.8)))
                    .animation(.easeOut(duration: 0.8), value: revealedText)
            }
            
            // Drop hint
            if isDraggingOver {
                Circle()
                    .stroke(Color(red: 1.0, green: 0.9, blue: 0.7).opacity(0.6), lineWidth: 3)
                    .scaleEffect(1.1)
                    .animation(.easeInOut(duration: 0.3).repeatForever(autoreverses: true), value: isDraggingOver)
            }
        }
        .aspectRatio(1.0, contentMode: .fit)
    }
}

struct GhostlyVignette: View {
    let recipeName: String
    @State private var opacity: Double = 0
    
    var body: some View {
        VStack(spacing: 20) {
            Text(recipeName)
                .font(.system(size: 28, weight: .ultraLight, design: .serif))
                .foregroundColor(Color.white)
            
            Text("A memory surfaces...")
                .font(.system(size: 16, weight: .light, design: .serif))
                .foregroundColor(Color.white.opacity(0.8))
        }
        .padding(40)
        .background(
            RoundedRectangle(cornerRadius: 20)
                .fill(Color.black.opacity(0.7))
                .blur(radius: 30)
        )
        .opacity(opacity)
        .onAppear {
            withAnimation(.easeIn(duration: 1.0)) {
                opacity = 1.0
            }
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                withAnimation(.easeOut(duration: 1.0)) {
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
    @Binding var isDraggingOverPot: Bool
    
    func performDrop(info: DropInfo) -> Bool {
        isDraggingOverPot = false
        
        guard let itemProvider = info.itemProviders(for: [.plainText]).first else {
            return false
        }
        
        itemProvider.loadObject(ofClass: NSString.self) { item, _ in
            guard let fragmentID = item as? String,
                  let uuid = UUID(uuidString: fragmentID),
                  let index = fragments.firstIndex(where: { $0.id == uuid }) else {
                return
            }
            
            DispatchQueue.main.async {
                withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                    fragments[index].isPlaced = true
                    potTemperature = min(potTemperature + 20, 100)
                }
                
                checkCombination()
            }
        }
        
        return true
    }
    
    func dropEntered(info: DropInfo) {
        isDraggingOverPot = true
    }
    
    func dropExited(info: DropInfo) {
        isDraggingOverPot = false
    }
    
    private func checkCombination() {
        let placedFragments = fragments.filter { $0.isPlaced }
        
        if placedFragments.count >= 3 {
            withAnimation(.easeInOut(duration: 1.0)) {
                revealedText = "The secret ingredient was always time spent together..."
                currentVignette = "Sunday Morning Bread"
                isCorrectCombination = true
            }
        }
    }
}