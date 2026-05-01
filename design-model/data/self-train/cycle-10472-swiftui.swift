struct ContentView: View {
    @State private var ingredients: [Ingredient] = [
        Ingredient(name: "Tomatoes", category: "produce", shelfLife: 7, isPreserved: false),
        Ingredient(name: "Basil", category: "herbs", shelfLife: 5, isPreserved: false),
        Ingredient(name: "Spinach", category: "greens", shelfLife: 4, isPreserved: false),
        Ingredient(name: "Salmon", category: "protein", shelfLife: 3, isPreserved: false),
        Ingredient(name: "Milk", category: "dairy", shelfLife: 6, isPreserved: false),
        Ingredient(name: "Eggs", category: "protein", shelfLife: 14, isPreserved: false),
        Ingredient(name: "Pasta", category: "grains", shelfLife: 365, isPreserved: true),
        Ingredient(name: "Rice", category: "grains", shelfLife: 365, isPreserved: true),
        Ingredient(name: "Olive Oil", category: "pantry", shelfLife: 365, isPreserved: true),
        Ingredient(name: "Garlic", category: "produce", shelfLife: 21, isPreserved: false),
        Ingredient(name: "Onions", category: "produce", shelfLife: 30, isPreserved: false),
        Ingredient(name: "Chicken", category: "protein", shelfLife: 2, isPreserved: false)
    ]
    
    @State private var meals: [Meal] = [
        Meal(name: "Caprese Pasta", requiredIngredients: ["Tomatoes", "Basil", "Pasta", "Olive Oil"], optimalDay: 3),
        Meal(name: "Spinach Salmon", requiredIngredients: ["Salmon", "Spinach", "Garlic", "Olive Oil"], optimalDay: 2),
        Meal(name: "Egg Fried Rice", requiredIngredients: ["Rice", "Eggs", "Onions"], optimalDay: 5),
        Meal(name: "Chicken Stir Fry", requiredIngredients: ["Chicken", "Rice", "Garlic", "Onions"], optimalDay: 1)
    ]
    
    @State private var currentDay: Int = 0
    @State private var spiralProgress: CGFloat = 0
    @State private var draggedIngredient: Ingredient?
    @State private var timelineHover: Bool = false
    @State private var revealedMeals: Set<UUID> = []
    
    var timelineIngredients: [Ingredient] {
        ingredients.filter { $0.addedToTimeline }.sorted { $0.timelinePosition < $1.timelinePosition }
    }
    
    func checkMealOverlaps() {
        for meal in meals.indices {
            let requiredIngredients = meals[meal].requiredIngredients
            let availableOnDay = timelineIngredients.filter { ingredient in
                let daysActive = meals[meal].optimalDay - ingredient.dayPlaced
                return daysActive >= 0 && daysActive < ingredient.shelfLife && requiredIngredients.contains(ingredient.name)
            }
            
            if Set(availableOnDay.map { $0.name }) == requiredIngredients {
                meals[meal].isRevealed = true
                revealedMeals.insert(meals[meal].id)
            }
        }
    }
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Dark background
                Color(red: 0.05, green: 0.05, blue: 0.08)
                    .ignoresSafeArea()
                
                HStack(spacing: 0) {
                    // Left panel - Ingredient inventory
                    VStack(alignment: .leading, spacing: 20) {
                        Text("FRESH INVENTORY")
                            .font(.system(size: 16, weight: .bold, design: .monospaced))
                            .foregroundColor(Color(red: 0.4, green: 0.8, blue: 0.4))
                            .padding(.top, 30)
                            .padding(.horizontal, 30)
                        
                        ScrollView {
                            VStack(alignment: .leading, spacing: 25) {
                                ForEach(["produce", "protein", "dairy", "herbs", "greens", "grains", "pantry"], id: \.self) { category in
                                    let categoryIngredients = ingredients.filter { $0.category == category && !$0.addedToTimeline }
                                    if !categoryIngredients.isEmpty {
                                        VStack(alignment: .leading, spacing: 15) {
                                            Text(category.uppercased())
                                                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                                .foregroundColor(Color(red: 0.6, green: 0.6, blue: 0.7))
                                            
                                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 70))], spacing: 15) {
                                                ForEach(categoryIngredients) { ingredient in
                                                    IngredientOrb(ingredient: ingredient, currentDay: currentDay, isOnTimeline: false)
                                                        .onDrag {
                                                            self.draggedIngredient = ingredient
                                                            return NSItemProvider(object: ingredient.id.uuidString as NSString)
                                                        }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            .padding(.horizontal, 30)
                        }
                    }
                    .frame(width: geometry.size.width * 0.25)
                    .background(Color(red: 0.08, green: 0.08, blue: 0.12))
                    
                    // Center - Temporal spiral timeline
                    ZStack {
                        // Spiral track
                        TimeSpiral(progress: 1.0)
                            .stroke(Color(red: 0.2, green: 0.2, blue: 0.3), lineWidth: 2)
                            .frame(width: geometry.size.width * 0.5, height: geometry.size.height * 0.8)
                        
                        // Day markers along spiral
                        ForEach(0..<7) { day in
                            let _ = spiralProgress
                            let _ = timelineHover
                            Circle()
                                .fill(Color(red: 0.3, green: 0.3, blue: 0.4))
                                .frame(width: 30, height: 30)
                                .overlay(
                                    Text("D\(day)")
                                        .font(.system(size: 10, weight: .medium))
                                        .foregroundColor(.white)
                                )
                                .position(x: geometry.size.width * 0.25, y: geometry.size.height * 0.4)
                        }
                    }
                    .frame(width: geometry.size.width * 0.5)
                    
                    // Right panel - Meal suggestions
                    VStack(alignment: .leading, spacing: 20) {
                        Text("MEAL TIMELINE")
                            .font(.system(size: 16, weight: .bold, design: .monospaced))
                            .foregroundColor(Color(red: 0.8, green: 0.4, blue: 0.4))
                            .padding(.top, 30)
                            .padding(.horizontal, 30)
                        
                        ScrollView {
                            VStack(spacing: 20) {
                                ForEach(meals) { meal in
                                    VStack(alignment: .leading, spacing: 10) {
                                        HStack {
                                            Text(meal.name)
                                                .font(.system(size: 14, weight: .semibold))
                                                .foregroundColor(meal.isRevealed ? .white : Color(red: 0.5, green: 0.5, blue: 0.6))
                                            
                                            Spacer()
                                            
                                            Text("Day \(meal.optimalDay)")
                                                .font(.system(size: 11, weight: .light))
                                                .foregroundColor(Color(red: 0.7, green: 0.7, blue: 0.8))
                                        }
                                        
                                        HStack(spacing: 5) {
                                            ForEach(Array(meal.requiredIngredients), id: \.self) { ingredient in
                                                Text(ingredient)
                                                    .font(.system(size: 10))
                                                    .foregroundColor(meal.isRevealed ? Color(red: 0.4, green: 0.8, blue: 0.4) : Color(red: 0.4, green: 0.4, blue: 0.5))
                                                    .padding(.horizontal, 8)
                                                    .padding(.vertical, 4)
                                                    .background(
                                                        RoundedRectangle(cornerRadius: 4)
                                                            .fill(Color(red: 0.1, green: 0.1, blue: 0.15))
                                                    )
                                            }
                                        }
                                    }
                                    .padding(15)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(meal.isRevealed ? Color(red: 0.1, green: 0.15, blue: 0.1) : Color(red: 0.08, green: 0.08, blue: 0.12))
                                    )
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 8)
                                            .stroke(meal.isRevealed ? Color(red: 0.4, green: 0.8, blue: 0.4) : Color.clear, lineWidth: 1)
                                    )
                                }
                            }
                            .padding(.horizontal, 30)
                        }
                    }
                    .frame(width: geometry.size.width * 0.25)
                    .background(Color(red: 0.08, green: 0.08, blue: 0.12))
                }
            }
        }
    }
}