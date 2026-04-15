struct ContentView: View {
    @State private var memoryFragments: [MemoryFragment] = [
        MemoryFragment(ingredient: "rosemary", flavorProfile: "sunday dinners", color: .green, position: CGPoint(x: 150, y: 400), timelinePosition: 0.1),
        MemoryFragment(ingredient: "butter", flavorProfile: "morning warmth", color: .yellow, position: CGPoint(x: 150, y: 500), timelinePosition: 0.3),
        MemoryFragment(ingredient: "garlic", flavorProfile: "laughter in kitchen", color: .orange, position: CGPoint(x: 150, y: 600), timelinePosition: 0.5),
        MemoryFragment(ingredient: "thyme", flavorProfile: "grandmother's hands", color: .purple, position: CGPoint(x: 150, y: 700), timelinePosition: 0.7),
        MemoryFragment(ingredient: "onion", flavorProfile: "tears of joy", color: .pink, position: CGPoint(x: 150, y: 800), timelinePosition: 0.9)
    ]
    
    @State private var placedFragments: [MemoryFragment] = []
    @State private var handwrittenNotes: [HandwrittenNote] = []
    @State private var potCenter: CGPoint = CGPoint(x: 720, y: 500)
    @State private var draggedFragment: MemoryFragment?
    @State private var recipeOpacity: Double = 0
    @State private var potGlow: Double = 0
    
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.98, green: 0.96, blue: 0.94),
                    Color(red: 0.96, green: 0.93, blue: 0.89)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            
            VStack(alignment: .leading, spacing: 24) {
                Text("Memory Fragments")
                    .font(.system(size: 14, weight: .medium, design: .serif))
                    .foregroundColor(Color(red: 0.5, green: 0.45, blue: 0.4))
                    .padding(.top, 40)
                
                ForEach(memoryFragments.filter { !$0.isPlaced }) { fragment in
                    FlavorCloud(fragment: fragment)
                        .opacity(fragment.opacity)
                        .draggable(fragment) {
                            FlavorCloud(fragment: fragment)
                                .opacity(0.8)
                                .scaleEffect(1.1)
                        }
                }
                
                Spacer()
            }
            .frame(width: 300)
            .position(x: 150, y: 450)
            
            VStack(spacing: 40) {
                VStack(spacing: 12) {
                    Text("Mother's Roast Chicken")
                        .font(.system(size: 36, weight: .light, design: .serif))
                        .foregroundColor(Color(red: 0.2, green: 0.15, blue: 0.1))
                        .opacity(recipeOpacity)
                    
                    Text("The one with the crispy skin she made every Sunday")
                        .font(.system(size: 16, weight: .light, design: .serif))
                        .foregroundColor(Color(red: 0.4, green: 0.35, blue: 0.3))
                        .opacity(recipeOpacity * 0.8)
                }
                .frame(maxWidth: 400)
                
                ZStack {
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    Color(red: 1, green: 0.95, blue: 0.85).opacity(potGlow),
                                    Color.clear
                                ],
                                center: .center,
                                startRadius: 100,
                                endRadius: 200
                            )
                        )
                        .frame(width: 400, height: 400)
                        .blur(radius: 20)
                    
                    CookingPot(placedFragments: placedFragments)
                        .frame(width: 200, height: 200)
                }
                .dropDestination(for: MemoryFragment.self) { items, _ in
                    for item in items {
                        withAnimation(.spring(response: 0.8, dampingFraction: 0.7)) {
                            if let index = memoryFragments.firstIndex(where: { $0.id == item.id }) {
                                memoryFragments[index].isPlaced = true
                                placedFragments.append(memoryFragments[index])
                                addHandwrittenNote(for: item)
                                recipeOpacity = min(1, recipeOpacity + 0.2)
                                potGlow = min(0.6, potGlow + 0.12)
                            }
                        }
                    }
                    return true
                }
                
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(handwrittenNotes) { note in
                        Text(note.text)
                            .font(.system(size: 15, weight: .light, design: .serif))
                            .italic()
                            .foregroundColor(Color(red: 0.4, green: 0.35, blue: 0.3))
                            .opacity(note.opacity)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(Color.white.opacity(0.5))
                            )
                    }
                }
                .frame(maxWidth: 350)
                .padding(.top, 20)
            }
            .position(x: 720, y: 450)
        }
        .frame(width: 1440, height: 900)
    }
    
    func addHandwrittenNote(for fragment: MemoryFragment) {
        let notes = [
            "rosemary": "always add a pinch more than you think",
            "butter": "she hummed while melting it slowly",
            "garlic": "crushed with the side of her knife",
            "thyme": "picked fresh from the windowsill garden",
            "onion": "diced while telling stories"
        ]
        
        if let noteText = notes[fragment.ingredient] {
            withAnimation(.easeOut(duration: 0.8).delay(0.3)) {
                let note = HandwrittenNote(
                    text: noteText,
                    position: CGPoint(x: 720, y: 650 + Double(handwrittenNotes.count) * 50),
                    rotation: 0,
                    handwriting: "serif",
                    opacity: 1
                )
                handwrittenNotes.append(note)
            }
        }
    }
}

struct FlavorCloud: View {
    let fragment: MemoryFragment
    
    var body: some View {
        VStack(spacing: 8) {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            fragment.color.opacity(0.3),
                            fragment.color.opacity(0.1)
                        ],
                        center: .center,
                        startRadius: 20,
                        endRadius: 40
                    )
                )
                .frame(width: 80, height: 80)
                .overlay(
                    Text(fragment.ingredient)
                        .font(.system(size: 14, weight: .medium, design: .serif))
                        .foregroundColor(Color(red: 0.3, green: 0.25, blue: 0.2))
                )
            
            Text(fragment.flavorProfile)
                .font(.system(size: 12, weight: .light, design: .serif))
                .italic()
                .foregroundColor(Color(red: 0.5, green: 0.45, blue: 0.4))
                .multilineTextAlignment(.center)
                .frame(width: 100)
        }
        .padding()
    }
}

struct CookingPot: View {
    let placedFragments: [MemoryFragment]
    
    var body: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(red: 0.85, green: 0.82, blue: 0.78),
                            Color(red: 0.7, green: 0.65, blue: 0.6)
                        ],
                        center: .center,
                        startRadius: 40,
                        endRadius: 100
                    )
                )
                .overlay(
                    Circle()
                        .strokeBorder(
                            Color(red: 0.6, green: 0.55, blue: 0.5),
                            lineWidth: 2
                        )
                )
            
            ForEach(Array(placedFragments.enumerated()), id: \.element.id) { index, fragment in
                Circle()
                    .fill(fragment.color.opacity(0.3))
                    .frame(width: 30, height: 30)
                    .offset(
                        x: cos(Double(index) * .pi / 3) * 50,
                        y: sin(Double(index) * .pi / 3) * 50
                    )
                    .transition(.scale.combined(with: .opacity))
            }
        }
    }
}

struct MemoryFragment: Identifiable, Codable, Transferable {
    let id = UUID()
    let ingredient: String
    let flavorProfile: String
    let color: Color
    var position: CGPoint
    let timelinePosition: Double
    var isPlaced: Bool = false
    var opacity: Double = 1
    
    enum CodingKeys: String, CodingKey {
        case id, ingredient, flavorProfile, position, timelinePosition, isPlaced, opacity
    }
    
    init(ingredient: String, flavorProfile: String, color: Color, position: CGPoint, timelinePosition: Double) {
        self.ingredient = ingredient
        self.flavorProfile = flavorProfile
        self.color = color
        self.position = position
        self.timelinePosition = timelinePosition
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        ingredient = try container.decode(String.self, forKey: .ingredient)
        flavorProfile = try container.decode(String.self, forKey: .flavorProfile)
        position = try container.decode(CGPoint.self, forKey: .position)
        timelinePosition = try container.decode(Double.self, forKey: .timelinePosition)
        isPlaced = try container.decode(Bool.self, forKey: .isPlaced)
        opacity = try container.decode(Double.self, forKey: .opacity)
        color = .blue
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(ingredient, forKey: .ingredient)
        try container.encode(flavorProfile, forKey: .flavorProfile)
        try container.encode(position, forKey: .position)
        try container.encode(timelinePosition, forKey: .timelinePosition)
        try container.encode(isPlaced, forKey: .isPlaced)
        try container.encode(opacity, forKey: .opacity)
    }
    
    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .text)
    }
}

struct HandwrittenNote: Identifiable {
    let id = UUID()
    let text: String
    let position: CGPoint
    let rotation: Double
    let handwriting: String
    var opacity: Double
}

extension CGPoint: Codable {
    enum CodingKeys: String, CodingKey {
        case x, y
    }
    
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let x = try container.decode(Double.self, forKey: .x)
        let y = try container.decode(Double.self, forKey: .y)
        self.init(x: x, y: y)
    }
    
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(x, forKey: .x)
        try container.encode(y, forKey: .y)
    }
}