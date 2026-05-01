struct ContentView: View {
    @State private var items: [GroceryItem] = [
        GroceryItem(name: "Tomatoes", timeState: TimeState(age: 0.3, position: CGPoint(x: 720, y: 300), velocity: .zero, mass: 0.3), isStaple: false, category: .produce, quantity: 6, lastPurchased: nil),
        GroceryItem(name: "Bread", timeState: TimeState(age: 1.2, position: CGPoint(x: 500, y: 450), velocity: .zero, mass: 0.5), isStaple: true, category: .grains, quantity: 1, lastPurchased: Date()),
        GroceryItem(name: "Milk", timeState: TimeState(age: 0.8, position: CGPoint(x: 900, y: 400), velocity: .zero, mass: 0.8), isStaple: true, category: .dairy, quantity: 1, lastPurchased: Date())
    ]
    @State private var draggedItems: Set<UUID> = []
    @State private var centerItems: [GroceryItem] = []
    @State private var suggestedRecipes: [Recipe] = []
    @State private var currentSeason: Double = 0.3
    @State private var pulsePhase: Double = 0
    @State private var physicsTimer: Timer?
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Canvas { context, size in
                    let gradient = Gradient(colors: [
                        Color(red: 0.95, green: 0.92, blue: 0.88),
                        Color(red: 0.98, green: 0.96, blue: 0.92),
                        Color(red: 0.93, green: 0.90, blue: 0.85)
                    ])
                    
                    context.fill(
                        Path(ellipseIn: CGRect(x: -200, y: -200, width: size.width + 400, height: size.height + 400)),
                        with: .linearGradient(gradient, startPoint: .zero, endPoint: CGPoint(x: size.width, y: size.height))
                    )
                }
                .ignoresSafeArea()
                
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(red: 0.85, green: 0.82, blue: 0.78).opacity(0.3),
                                Color(red: 0.75, green: 0.72, blue: 0.68).opacity(0.1)
                            ],
                            center: .center,
                            startRadius: 5,
                            endRadius: 150
                        )
                    )
                    .frame(width: 300, height: 300)
                    .position(x: geometry.size.width / 2, y: geometry.size.height / 2)
                
                ForEach(suggestedRecipes) { recipe in
                    RecipeBloomView(recipe: recipe)
                        .position(
                            x: geometry.size.width / 2 + Double.random(in: -100...100),
                            y: geometry.size.height / 2 + Double.random(in: -100...100)
                        )
                }
                
                ForEach(items) { item in
                    GroceryItemView(
                        item: item,
                        pulsePhase: pulsePhase,
                        isDragged: draggedItems.contains(item.id)
                    )
                    .position(item.timeState.position)
                    .onDrag {
                        draggedItems.insert(item.id)
                        return NSItemProvider(object: item.id.uuidString as NSString)
                    }
                    .onDrop(of: [.text], delegate: DropDelegate(
                        itemId: item.id,
                        items: $items,
                        draggedItems: $draggedItems,
                        centerItems: $centerItems,
                        suggestedRecipes: $suggestedRecipes,
                        geometry: geometry
                    ))
                }
                
                VStack {
                    HStack {
                        Spacer()
                        SeasonIndicator(progress: currentSeason)
                            .frame(width: 120, height: 120)
                            .padding(40)
                    }
                    Spacer()
                }
                
                VStack {
                    Spacer()
                    HStack {
                        AddItemButton(items: $items)
                            .padding(40)
                        Spacer()
                    }
                }
            }
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            startPhysicsSimulation()
            startPulseAnimation()
        }
    }
    
    func startPhysicsSimulation() {
        physicsTimer = Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { _ in
            for i in items.indices {
                let gravity = items[i].timeState.mass * 2.0
                items[i].timeState.velocity.height += gravity
                
                if items[i].timeState.mass < 0.4 {
                    items[i].timeState.velocity.height -= 1.5
                }
                
                items[i].timeState.position.x += items[i].timeState.velocity.width
                items[i].timeState.position.y += items[i].timeState.velocity.height
                
                if items[i].timeState.position.y > 850 {
                    items[i].timeState.position.y = 850
                    items[i].timeState.velocity.height *= -0.4
                }
                if items[i].timeState.position.y < 50 {
                    items[i].timeState.position.y = 50
                    items[i].timeState.velocity.height *= -0.4
                }
                if items[i].timeState.position.x > 1390 {
                    items[i].timeState.position.x = 1390
                    items[i].timeState.velocity.width *= -0.4
                }
                if items[i].timeState.position.x < 50 {
                    items[i].timeState.position.x = 50
                    items[i].timeState.velocity.width *= -0.4
                }
                
                items[i].timeState.velocity.width *= 0.98
                items[i].timeState.velocity.height *= 0.98
                
                items[i].timeState.age += 0.016
            }
        }
    }
    
    func startPulseAnimation() {
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            pulsePhase += 0.1
        }
    }
}