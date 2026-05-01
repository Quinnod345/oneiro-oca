struct ContentView: View {
    @State private var ingredients: [IngredientToken] = [
        IngredientToken(name: "Cheese", baseColor: .yellow, position: CGPoint(x: 200, y: 200)),
        IngredientToken(name: "Wine", baseColor: .red, position: CGPoint(x: 1240, y: 200)),
        IngredientToken(name: "Bread", baseColor: .orange, position: CGPoint(x: 200, y: 700)),
        IngredientToken(name: "Herbs", baseColor: .green, position: CGPoint(x: 1240, y: 700))
    ]
    
    @State private var timeRotation: Double = 0
    @State private var isDraggingDial: Bool = false
    @State private var activeIngredients: Set<UUID> = []
    @State private var flavorNotes: [FlavorNote] = []
    @State private var backgroundPhase: Double = 0.5
    
    let centerPoint = CGPoint(x: 720, y: 450)
    let dialRadius: CGFloat = 280
    
    var backgroundGradient: LinearGradient {
        let dayColor = Color(red: 0.95, green: 0.92, blue: 0.88)
        let nightColor = Color(red: 0.08, green: 0.07, blue: 0.12)
        let phase = (sin(backgroundPhase * .pi * 2) + 1) / 2
        
        return LinearGradient(
            colors: [
                dayColor.opacity(1 - phase * 0.7),
                nightColor.opacity(phase)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
    
    var body: some View {
        ZStack {
            backgroundGradient
                .ignoresSafeArea()
                .animation(.easeInOut(duration: 0.8), value: backgroundPhase)
            
            // Subtle texture overlay
            ForEach(0..<30) { i in
                Circle()
                    .fill(Color.white.opacity(0.02))
                    .frame(width: CGFloat(i * 40 + 100))
                    .position(
                        x: centerPoint.x + cos(Double(i) * 0.5) * 100,
                        y: centerPoint.y + sin(Double(i) * 0.5) * 100
                    )
                    .blur(radius: 20)
            }
            
            // Central dish
            Circle()
                .fill(Color(red: 0.15, green: 0.14, blue: 0.13))
                .frame(width: 320, height: 320)
                .position(centerPoint)
                .shadow(color: .black.opacity(0.3), radius: 20, x: 0, y: 10)
            
            Circle()
                .fill(Color(red: 0.92, green: 0.91, blue: 0.89))
                .frame(width: 280, height: 280)
                .position(centerPoint)
            
            // Time dial
            ZStack {
                Circle()
                    .stroke(Color.white.opacity(0.1), lineWidth: 60)
                    .frame(width: dialRadius * 2, height: dialRadius * 2)
                    .position(centerPoint)
                
                ForEach(0..<24) { hour in
                    let angle = (Double(hour) / 24.0) * 360 - 90 + timeRotation
                    let radians = angle * .pi / 180
                    
                    Rectangle()
                        .fill(Color.white.opacity(hour % 6 == 0 ? 0.4 : 0.2))
                        .frame(width: hour % 6 == 0 ? 3 : 1, height: hour % 6 == 0 ? 20 : 10)
                        .position(
                            x: centerPoint.x + cos(radians) * dialRadius,
                            y: centerPoint.y + sin(radians) * dialRadius
                        )
                        .rotationEffect(.degrees(angle + 90))
                }
                
                // Dial handle
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [Color.white, Color.gray],
                            center: .center,
                            startRadius: 0,
                            endRadius: 15
                        )
                    )
                    .frame(width: 30, height: 30)
                    .position(
                        x: centerPoint.x + cos((timeRotation - 90) * .pi / 180) * dialRadius,
                        y: centerPoint.y + sin((timeRotation - 90) * .pi / 180) * dialRadius
                    )
                    .shadow(color: .black.opacity(0.3), radius: 5)
            }
            .gesture(
                DragGesture()
                    .onChanged { value in
                        let vector = CGSize(
                            width: value.location.x - centerPoint.x,
                            height: value.location.y - centerPoint.y
                        )
                        let angle = atan2(vector.height, vector.width) * 180 / .pi + 90
                        timeRotation = angle
                        isDraggingDial = true
                        updateIngredientAges()
                        backgroundPhase = timeRotation / 360
                    }
                    .onEnded { _ in
                        isDraggingDial = false
                    }
            )
            
            // Ingredients
            ForEach(ingredients.indices, id: \.self) { index in
                let ingredient = ingredients[index]
                
                ZStack {
                    // Decay visualization
                    if ingredient.ageLevel > 0.7 {
                        ForEach(0..<5) { i in
                            Circle()
                                .fill(Color.black.opacity(0.05))
                                .frame(
                                    width: 60 + CGFloat(i) * 10,
                                    height: 60 + CGFloat(i) * 10
                                )
                                .offset(
                                    x: sin(Double(i) * ingredient.ageLevel) * 3,
                                    y: cos(Double(i) * ingredient.ageLevel) * 3
                                )
                        }
                    }
                    
                    Circle()
                        .fill(ingredient.currentColor)
                        .frame(width: 80, height: 80)
                        .overlay(
                            Circle()
                                .stroke(Color.white.opacity(0.3), lineWidth: 2)
                        )
                        .shadow(
                            color: ingredient.isInDish ? Color.yellow.opacity(0.5) : Color.black.opacity(0.2),
                            radius: ingredient.isInDish ? 15 : 8
                        )
                    
                    Text(ingredient.name)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.white)
                        .shadow(color: .black, radius: 2)
                }
                .position(ingredient.position)
                .scaleEffect(ingredient.isInDish ? 0.9 : 1.0)
                .animation(.spring(response: 0.3), value: ingredient.isInDish)
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            ingredients[index].position = value.location
                            checkIfInDish(index: index)
                        }
                )
            }
            
            // Flavor notes
            ForEach(flavorNotes) { note in
                Text(note.text)
                    .font(.system(size: 16, weight: .light, design: .serif))
                    .foregroundColor(Color.white.opacity(0.8))
                    .padding(8)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.black.opacity(0.3))
                    )
                    .position(note.position)
                    .transition(.opacity.combined(with: .scale))
            }
        }
        .frame(width: 1440, height: 900)
        .background(Color.black)
    }
    
    func updateIngredientAges() {
        for index in ingredients.indices {
            if ingredients[index].isInDish {
                ingredients[index].ageLevel = min(1.0, ingredients[index].ageLevel + 0.02)
            }
        }
    }
    
    func checkIfInDish(index: Int) {
        let distance = sqrt(
            pow(ingredients[index].position.x - centerPoint.x, 2) +
            pow(ingredients[index].position.y - centerPoint.y, 2)
        )
        
        let wasInDish = ingredients[index].isInDish
        ingredients[index].isInDish = distance < 140
        
        if ingredients[index].isInDish && !wasInDish {
            activeIngredients.insert(ingredients[index].id)
            generateFlavorNote(for: ingredients[index])
        } else if !ingredients[index].isInDish && wasInDish {
            activeIngredients.remove(ingredients[index].id)
        }
    }
    
    func generateFlavorNote(for ingredient: IngredientToken) {
        let notes = [
            "Cheese": ["Rich umami", "Creamy depth", "Aged complexity"],
            "Wine": ["Bright acidity", "Fruity notes", "Tannin structure"],
            "Bread": ["Earthy warmth", "Yeast aroma", "Crispy texture"],
            "Herbs": ["Fresh brightness", "Aromatic lift", "Green vitality"]
        ]
        
        if let noteOptions = notes[ingredient.name], let note = noteOptions.randomElement() {
            let newNote = FlavorNote(
                text: note,
                position: CGPoint(
                    x: ingredient.position.x + CGFloat.random(in: -50...50),
                    y: ingredient.position.y - 60
                )
            )
            
            withAnimation {
                flavorNotes.append(newNote)
            }
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                withAnimation {
                    flavorNotes.removeAll { $0.id == newNote.id }
                }
            }
        }
    }
}