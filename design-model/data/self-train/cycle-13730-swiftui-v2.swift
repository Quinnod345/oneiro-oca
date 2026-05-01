struct ContentView: View {
    @State private var ingredients: [IngredientToken] = [
        IngredientToken(name: "Cheese", baseColor: Color(red: 0.95, green: 0.85, blue: 0.4), position: CGPoint(x: 200, y: 200)),
        IngredientToken(name: "Wine", baseColor: Color(red: 0.7, green: 0.2, blue: 0.3), position: CGPoint(x: 1240, y: 200)),
        IngredientToken(name: "Bread", baseColor: Color(red: 0.8, green: 0.6, blue: 0.4), position: CGPoint(x: 200, y: 700)),
        IngredientToken(name: "Herbs", baseColor: Color(red: 0.3, green: 0.6, blue: 0.3), position: CGPoint(x: 1240, y: 700))
    ]
    
    @State private var timeValue: Double = 0
    @State private var activeIngredients: Set<UUID> = []
    @State private var draggedIngredient: UUID? = nil
    
    let centerPoint = CGPoint(x: 720, y: 450)
    let plateRadius: CGFloat = 180
    
    var backgroundGradient: LinearGradient {
        let baseColor = Color(red: 0.98, green: 0.97, blue: 0.95)
        let accentColor = Color(red: 0.94, green: 0.93, blue: 0.92)
        
        return LinearGradient(
            colors: [baseColor, accentColor],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
    
    var body: some View {
        ZStack {
            backgroundGradient
                .ignoresSafeArea()
            
            // Plate
            Circle()
                .fill(Color(red: 0.25, green: 0.24, blue: 0.23))
                .frame(width: plateRadius * 2 + 20, height: plateRadius * 2 + 20)
                .position(centerPoint)
                .shadow(color: Color.black.opacity(0.1), radius: 15, x: 0, y: 8)
            
            Circle()
                .fill(Color.white)
                .frame(width: plateRadius * 2, height: plateRadius * 2)
                .position(centerPoint)
            
            // Active ingredients on plate
            ForEach(ingredients.filter { activeIngredients.contains($0.id) }) { ingredient in
                Circle()
                    .fill(ingredient.baseColor.opacity(0.8 - ingredient.age * 0.5))
                    .frame(width: 60, height: 60)
                    .position(ingredient.position)
                    .scaleEffect(draggedIngredient == ingredient.id ? 1.1 : 1.0)
                    .animation(.spring(response: 0.3, dampingFraction: 0.8), value: ingredient.position)
            }
            
            // Time control
            VStack {
                Spacer()
                
                VStack(spacing: 20) {
                    Text("Aging Time")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(Color(red: 0.3, green: 0.3, blue: 0.3))
                    
                    HStack(spacing: 40) {
                        ForEach([0, 6, 12, 18, 24], id: \.self) { hour in
                            VStack(spacing: 8) {
                                Rectangle()
                                    .fill(Color(red: 0.7, green: 0.7, blue: 0.7))
                                    .frame(width: 2, height: hour == Int(timeValue) ? 20 : 10)
                                    .opacity(hour == Int(timeValue) ? 1 : 0.5)
                                
                                Text("\(hour)h")
                                    .font(.system(size: 12))
                                    .foregroundColor(Color(red: 0.5, green: 0.5, blue: 0.5))
                            }
                        }
                    }
                    
                    Slider(value: $timeValue, in: 0...24, step: 1)
                        .frame(width: 300)
                        .tint(Color(red: 0.4, green: 0.4, blue: 0.4))
                        .onChange(of: timeValue) { _ in
                            updateIngredientAges()
                        }
                }
                .padding(30)
                .background(
                    RoundedRectangle(cornerRadius: 20)
                        .fill(Color.white)
                        .shadow(color: Color.black.opacity(0.05), radius: 10, x: 0, y: 5)
                )
                .padding(.bottom, 50)
            }
            
            // Ingredient tokens
            ForEach(ingredients.filter { !activeIngredients.contains($0.id) }) { ingredient in
                VStack(spacing: 12) {
                    Circle()
                        .fill(ingredient.baseColor)
                        .frame(width: 80, height: 80)
                        .overlay(
                            Circle()
                                .stroke(Color.white, lineWidth: 3)
                        )
                        .shadow(color: Color.black.opacity(0.1), radius: 5, x: 0, y: 3)
                    
                    Text(ingredient.name)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(Color(red: 0.3, green: 0.3, blue: 0.3))
                }
                .position(ingredient.position)
                .scaleEffect(draggedIngredient == ingredient.id ? 1.15 : 1.0)
                .animation(.spring(response: 0.3, dampingFraction: 0.8), value: draggedIngredient)
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            draggedIngredient = ingredient.id
                            if let index = ingredients.firstIndex(where: { $0.id == ingredient.id }) {
                                ingredients[index].position = value.location
                            }
                        }
                        .onEnded { value in
                            draggedIngredient = nil
                            let distance = sqrt(
                                pow(value.location.x - centerPoint.x, 2) +
                                pow(value.location.y - centerPoint.y, 2)
                            )
                            
                            if distance < plateRadius {
                                activeIngredients.insert(ingredient.id)
                                if let index = ingredients.firstIndex(where: { $0.id == ingredient.id }) {
                                    let angle = Double.random(in: 0...(2 * .pi))
                                    let radius = Double.random(in: 40...120)
                                    ingredients[index].position = CGPoint(
                                        x: centerPoint.x + cos(angle) * radius,
                                        y: centerPoint.y + sin(angle) * radius
                                    )
                                }
                            }
                        }
                )
            }
            
            // Freshness indicators
            ForEach(ingredients.filter { activeIngredients.contains($0.id) }) { ingredient in
                if ingredient.age > 0.3 {
                    Image(systemName: "clock.fill")
                        .font(.system(size: 14))
                        .foregroundColor(Color(red: 0.8, green: 0.4, blue: 0.2))
                        .position(
                            x: ingredient.position.x + 25,
                            y: ingredient.position.y - 25
                        )
                        .opacity(min(1.0, ingredient.age))
                        .animation(.easeInOut(duration: 0.5), value: ingredient.age)
                }
            }
        }
    }
    
    func updateIngredientAges() {
        for index in ingredients.indices {
            if activeIngredients.contains(ingredients[index].id) {
                ingredients[index].age = timeValue / 24.0
            }
        }
    }
}