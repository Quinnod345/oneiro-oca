struct ContentView: View {
    @State private var memoryFragments: [MemoryFragment] = [
        MemoryFragment(ingredient: "rosemary", flavorProfile: "sunday dinners", color: .green, position: CGPoint(x: 200, y: 300), timelinePosition: 0.1),
        MemoryFragment(ingredient: "butter", flavorProfile: "morning warmth", color: .yellow, position: CGPoint(x: 400, y: 200), timelinePosition: 0.3),
        MemoryFragment(ingredient: "garlic", flavorProfile: "laughter in kitchen", color: .orange, position: CGPoint(x: 600, y: 350), timelinePosition: 0.5),
        MemoryFragment(ingredient: "thyme", flavorProfile: "grandmother's hands", color: .purple, position: CGPoint(x: 800, y: 250), timelinePosition: 0.7),
        MemoryFragment(ingredient: "onion", flavorProfile: "tears of joy", color: .pink, position: CGPoint(x: 1000, y: 400), timelinePosition: 0.9)
    ]
    
    @State private var placedFragments: [MemoryFragment] = []
    @State private var handwrittenNotes: [HandwrittenNote] = []
    @State private var potCenter: CGPoint = CGPoint(x: 720, y: 450)
    @State private var spiralRotation: Double = 0
    @State private var interfaceTint: Double = 0
    @State private var draggedFragment: MemoryFragment?
    @State private var recipeOpacity: Double = 0
    
    var body: some View {
        ZStack {
            Color(red: 0.98 - interfaceTint * 0.08, green: 0.97 - interfaceTint * 0.07, blue: 0.95 - interfaceTint * 0.1)
                .ignoresSafeArea()
            
            ForEach(0..<20) { i in
                Path { path in
                    let angle = Double(i) * .pi / 10
                    let radius = Double(i) * 40
                    path.move(to: potCenter)
                    path.addArc(
                        center: potCenter,
                        radius: radius,
                        startAngle: .radians(angle + spiralRotation),
                        endAngle: .radians(angle + 0.5 + spiralRotation),
                        clockwise: false
                    )
                }
                .stroke(Color(red: 0.8, green: 0.75, blue: 0.7).opacity(0.1), lineWidth: 1)
            }
            
            ForEach(memoryFragments.filter { !$0.isPlaced }) { fragment in
                FlavorCloud(fragment: fragment)
                    .position(fragment.position)
                    .opacity(fragment.opacity)
                    .draggable(fragment) {
                        FlavorCloud(fragment: fragment)
                            .opacity(0.8)
                    }
                    .dropDestination(for: MemoryFragment.self) { _, _ in
                        false
                    }
            }
            
            CookingPot(placedFragments: placedFragments)
                .position(potCenter)
                .dropDestination(for: MemoryFragment.self) { items, _ in
                    for item in items {
                        withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
                            if let index = memoryFragments.firstIndex(where: { $0.id == item.id }) {
                                memoryFragments[index].isPlaced = true
                                placedFragments.append(memoryFragments[index])
                                addHandwrittenNote(for: item)
                                recipeOpacity = min(1, recipeOpacity + 0.2)
                            }
                        }
                    }
                    return true
                }
            
            ForEach(handwrittenNotes) { note in
                Text(note.text)
                    .font(.custom(note.handwriting, size: 16))
                    .foregroundColor(Color(red: 0.3, green: 0.25, blue: 0.2))
                    .rotationEffect(.degrees(note.rotation))
                    .position(note.position)
                    .opacity(note.opacity)
            }
            
            VStack {
                Text("Mother's Roast Chicken")
                    .font(.system(size: 32, weight: .light, design: .serif))
                    .foregroundColor(Color(red: 0.2, green: 0.15, blue: 0.1))
                    .opacity(recipeOpacity)
                
                Text("The one with the crispy skin she made every Sunday")
                    .font(.system(size: 18, weight: .light, design: .serif))
                    .foregroundColor(Color(red: 0.4, green: 0.35, blue: 0.3))
                    .opacity(recipeOpacity * 0.8)
            }
            .position(x: 720, y: 100)
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            withAnimation(.linear(duration: 60).repeatForever(autoreverses: false)) {
                spiralRotation = .pi * 2
            }
        }
    }
    
    func addHandwrittenNote(for fragment: MemoryFragment) {
        let notes = [
            "always add a pinch more than you think",
            "she hummed while cooking this part",
            "the secret was in the timing",
            "I can still smell it cooking",
            "we gathered here every week"
        ]
        
        let fonts = ["Baskerville", "Didot", "Georgia", "Palatino", "Cochin"]
        
        let note = HandwrittenNote(
            text: notes.randomElement() ?? "",
            position: CGPoint(
                x: potCenter.x + CGFloat.random(in: -300...300),
                y: potCenter.y + CGFloat.random(in: -200...200)
            ),
            rotation: Double.random(in: -15...15),
            handwriting: fonts.randomElement() ?? "Baskerville"
        )
        
        handwrittenNotes.append(note)
        
        withAnimation(.easeIn(duration: 1.5)) {
            if let index = handwrittenNotes.firstIndex(where: { $0.id == note.id }) {
                handwrittenNotes[index].opacity = 0.7
            }
        }
    }
}