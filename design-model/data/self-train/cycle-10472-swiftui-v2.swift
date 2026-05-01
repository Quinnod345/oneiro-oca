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
    @State private var draggedIngredient: Ingredient?
    @State private var selectedDay: Int? = nil
    @State private var hoveredIngredient: Ingredient? = nil
    
    let categoryColors: [String: Color] = [
        "produce": Color(red: 0.4, green: 0.7, blue: 0.5),
        "herbs": Color(red: 0.5, green: 0.8, blue: 0.6),
        "greens": Color(red: 0.3, green: 0.6, blue: 0.4),
        "protein": Color(red: 0.8, green: 0.5, blue: 0.4),
        "dairy": Color(red: 0.6, green: 0.7, blue: 0.8),
        "grains": Color(red: 0.7, green: 0.6, blue: 0.4),
        "pantry": Color(red: 0.6, green: 0.5, blue: 0.7)
    ]
    
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
            
            meals[meal].isRevealed = Set(availableOnDay.map { $0.name }) == Set(requiredIngredients)
        }
    }
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color(red: 0.08, green: 0.1, blue: 0.15)
                    .ignoresSafeArea()
                
                HStack(spacing: 0) {
                    // Left panel - Ingredient inventory
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Fresh Inventory")
                            .font(.system(size: 28, weight: .semibold, design: .default))
                            .foregroundColor(.white)
                            .padding(.top, 40)
                            .padding(.horizontal, 32)
                            .padding(.bottom, 24)
                        
                        ScrollView {
                            VStack(alignment: .leading, spacing: 24) {
                                ForEach(["produce", "protein", "dairy", "herbs", "greens", "grains", "pantry"], id: \.self) { category in
                                    let categoryIngredients = ingredients.filter { $0.category == category && !$0.addedToTimeline }
                                    if !categoryIngredients.isEmpty {
                                        VStack(alignment: .leading, spacing: 16) {
                                            Text(category.capitalized)
                                                .font(.system(size: 14, weight: .medium, design: .default))
                                                .foregroundColor(categoryColors[category]?.opacity(0.8) ?? .white)
                                                .padding(.horizontal, 32)
                                            
                                            ScrollView(.horizontal, showsIndicators: false) {
                                                HStack(spacing: 12) {
                                                    ForEach(categoryIngredients) { ingredient in
                                                        IngredientCard(
                                                            ingredient: ingredient,
                                                            color: categoryColors[ingredient.category] ?? .gray,
                                                            isHovered: hoveredIngredient?.id == ingredient.id
                                                        )
                                                        .onDrag {
                                                            self.draggedIngredient = ingredient
                                                            return NSItemProvider(object: ingredient.id.uuidString as NSString)
                                                        }
                                                        .onHover { isHovered in
                                                            withAnimation(.easeInOut(duration: 0.2)) {
                                                                hoveredIngredient = isHovered ? ingredient : nil
                                                            }
                                                        }
                                                    }
                                                }
                                                .padding(.horizontal, 32)
                                            }
                                        }
                                    }
                                }
                            }
                            .padding(.bottom, 40)
                        }
                    }
                    .frame(width: geometry.size.width * 0.35)
                    .background(Color(red: 0.06, green: 0.08, blue: 0.12))
                    
                    // Right panel - Timeline
                    VStack(spacing: 0) {
                        Text("Meal Timeline")
                            .font(.system(size: 28, weight: .semibold, design: .default))
                            .foregroundColor(.white)
                            .padding(.top, 40)
                            .padding(.bottom, 32)
                        
                        ScrollView {
                            VStack(spacing: 0) {
                                ForEach(0..<7) { day in
                                    TimelineDay(
                                        day: day,
                                        ingredients: timelineIngredients.filter { $0.dayPlaced == day },
                                        meals: meals.filter { $0.optimalDay == day && $0.isRevealed },
                                        isSelected: selectedDay == day,
                                        categoryColors: categoryColors
                                    )
                                    .onTapGesture {
                                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                                            selectedDay = selectedDay == day ? nil : day
                                        }
                                    }
                                    .onDrop(of: [.text], delegate: DropDelegate(
                                        day: day,
                                        ingredients: $ingredients,
                                        draggedIngredient: $draggedIngredient,
                                        checkMealOverlaps: checkMealOverlaps
                                    ))
                                }
                            }
                            .padding(.bottom, 40)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }
}

struct IngredientCard: View {
    let ingredient: Ingredient
    let color: Color
    let isHovered: Bool
    
    var body: some View {
        VStack(spacing: 8) {
            Circle()
                .fill(color.opacity(0.2))
                .overlay(
                    Circle()
                        .stroke(color, lineWidth: 2)
                )
                .frame(width: 56, height: 56)
                .overlay(
                    Text(String(ingredient.name.prefix(2)).uppercased())
                        .font(.system(size: 16, weight: .medium, design: .default))
                        .foregroundColor(color)
                )
                .scaleEffect(isHovered ? 1.1 : 1.0)
            
            VStack(spacing: 2) {
                Text(ingredient.name)
                    .font(.system(size: 12, weight: .medium, design: .default))
                    .foregroundColor(.white)
                
                Text("\(ingredient.shelfLife)d")
                    .font(.system(size: 11, weight: .regular, design: .default))
                    .foregroundColor(.white.opacity(0.5))
            }
        }
        .frame(width: 80)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.white.opacity(isHovered ? 0.08 : 0.03))
        )
    }
}

struct TimelineDay: View {
    let day: Int
    let ingredients: [Ingredient]
    let meals: [Meal]
    let isSelected: Bool
    let categoryColors: [String: Color]
    
    var body: some View {
        HStack(spacing: 0) {
            // Day indicator
            VStack(spacing: 4) {
                Text("Day")
                    .font(.system(size: 12, weight: .regular, design: .default))
                    .foregroundColor(.white.opacity(0.5))
                Text("\(day)")
                    .font(.system(size: 24, weight: .semibold, design: .default))
                    .foregroundColor(.white)
            }
            .frame(width: 80)
            
            // Timeline content
            HStack(spacing: 16) {
                // Ingredients
                ForEach(ingredients) { ingredient in
                    HStack(spacing: 12) {
                        Circle()
                            .fill(categoryColors[ingredient.category]?.opacity(0.2) ?? Color.gray.opacity(0.2))
                            .overlay(
                                Circle()
                                    .stroke(categoryColors[ingredient.category] ?? .gray, lineWidth: 2)
                            )
                            .frame(width: 44, height: 44)
                            .overlay(
                                Text(String(ingredient.name.prefix(2)).uppercased())
                                    .font(.system(size: 14, weight: .medium, design: .default))
                                    .foregroundColor(categoryColors[ingredient.category] ?? .gray)
                            )
                        
                        VStack(alignment: .leading, spacing: 2) {
                            Text(ingredient.name)
                                .font(.system(size: 14, weight: .medium, design: .default))
                                .foregroundColor(.white)
                            
                            Text("Expires in \(ingredient.shelfLife - (day - ingredient.dayPlaced))d")
                                .font(.system(size: 12, weight: .regular, design: .default))
                                .foregroundColor(.white.opacity(0.5))
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.white.opacity(0.05))
                    )
                }
                
                // Meals
                ForEach(meals) { meal in
                    HStack(spacing: 12) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 24))
                            .foregroundColor(.green.opacity(0.8))
                        
                        Text(meal.name)
                            .font(.system(size: 16, weight: .semibold, design: .default))
                            .foregroundColor(.white)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.green.opacity(0.15))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(Color.green.opacity(0.3), lineWidth: 1)
                            )
                    )
                }
                
                Spacer()
            }
            .frame(maxWidth: .infinity)
            .frame(height: 100)
            .padding(.horizontal, 24)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color.white.opacity(isSelected ? 0.08 : 0.03))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(Color.white.opacity(isSelected ? 0.2 : 0.05), lineWidth: 1)
                    )
            )
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 8)
    }
}

struct DropDelegate: DropDelegate {
    let day: Int
    @Binding var ingredients: [Ingredient]
    @Binding var draggedIngredient: Ingredient?
    let checkMealOverlaps: () -> Void
    
    func performDrop(info: DropInfo) -> Bool {
        guard let draggedIngredient = draggedIngredient,
              let index = ingredients.firstIndex(where: { $0.id == draggedIngredient.id }) else {
            return false
        }
        
        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
            ingredients[index].addedToTimeline = true
            ingredients[index].dayPlaced = day
            ingredients[index].timelinePosition = day
        }
        
        checkMealOverlaps()
        return true
    }
    
    func dropEntered(info: DropInfo) {
        withAnimation(.easeInOut(duration: 0.2)) {}
    }
    
    func dropExited(info: DropInfo) {
        withAnimation(.easeInOut(duration: 0.2)) {}
    }
}

struct Ingredient: Identifiable {
    let id = UUID()
    let name: String
    let category: String
    let shelfLife: Int
    let isPreserved: Bool
    var addedToTimeline: Bool = false
    var dayPlaced: Int = 0
    var timelinePosition: Int = 0
}

struct Meal: Identifiable {
    let id = UUID()
    let name: String
    let requiredIngredients: Set<String>
    let optimalDay: Int
    var isRevealed: Bool = false
}