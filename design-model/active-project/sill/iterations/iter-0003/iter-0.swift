struct ContentView: View {
    @State private var shelfItems: [ShelfItem] = [
        ShelfItem(title: "Project Alpha", lastUsed: Date().addingTimeInterval(-3600)),
        ShelfItem(title: "Design System", lastUsed: Date().addingTimeInterval(-86400 * 1.5)),
        ShelfItem(title: "API Documentation", lastUsed: Date().addingTimeInterval(-86400 * 3)),
        ShelfItem(title: "Team Notes", lastUsed: Date().addingTimeInterval(-86400 * 5.5)),
        ShelfItem(title: "Archive", lastUsed: Date().addingTimeInterval(-86400 * 6.8))
    ]
    
    @State private var hoveredSlot: Int? = nil
    @State private var pulsePhase: Double = 0.0
    
    var body: some View {
        ZStack {
            // Warm walnut background
            Rectangle()
                .fill(
                    LinearGradient(
                        gradient: Gradient(colors: [
                            Color(red: 0.45, green: 0.32, blue: 0.22),
                            Color(red: 0.38, green: 0.26, blue: 0.18)
                        ]),
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
            
            // Subtle wood grain texture overlay
            Rectangle()
                .fill(
                    RadialGradient(
                        gradient: Gradient(colors: [
                            Color(red: 0.5, green: 0.35, blue: 0.25).opacity(0.3),
                            Color.clear
                        ]),
                        center: UnitPoint(x: 0.3, y: 0.2),
                        startRadius: 50,
                        endRadius: 400
                    )
                )
            
            // Ambient lighting effect
            Rectangle()
                .fill(
                    LinearGradient(
                        gradient: Gradient(colors: [
                            Color(red: 1.0, green: 0.9, blue: 0.7).opacity(0.15),
                            Color.clear,
                            Color(red: 0.2, green: 0.1, blue: 0.05).opacity(0.2)
                        ]),
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
            
            HStack(spacing: 16) {
                ForEach(0..<8, id: \.self) { index in
                    ShelfSlotView(
                        item: index < shelfItems.count ? shelfItems[index] : nil,
                        isHovered: hoveredSlot == index,
                        pulsePhase: pulsePhase
                    )
                    .onHover { isHovering in
                        hoveredSlot = isHovering ? index : nil
                    }
                }
            }
            .padding(.horizontal, 32)
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            startPulseAnimation()
        }
    }
    
    private func startPulseAnimation() {
        withAnimation(.linear(duration: 3.0).repeatForever(autoreverses: false)) {
            pulsePhase = 1.0
        }
    }
}

struct ShelfSlotView: View {
    let item: ShelfItem?
    let isHovered: Bool
    let pulsePhase: Double
    
    private var ageInDays: Double {
        guard let item = item else { return 0 }
        return Date().timeIntervalSince(item.lastUsed) / 86400
    }
    
    private var itemOpacity: Double {
        guard item != nil else { return 0.3 }
        if ageInDays <= 2 { return 1.0 }
        if ageInDays <= 5 { return 0.85 }
        return max(0.4, 1.0 - (ageInDays - 5) / 2 * 0.45)
    }
    
    private var glowIntensity: Double {
        guard item != nil else { return 0 }
        if ageInDays <= 2 {
            return 1.0 - (ageInDays / 2) * 0.3
        }
        return 0.0
    }
    
    private var itemColor: Color {
        guard item != nil else { return Color(red: 0.6, green: 0.55, blue: 0.48) }
        
        if ageInDays <= 2 {
            // Warm amber to neutral transition
            let progress = ageInDays / 2
            let red = 0.95 - (progress * 0.25)
            let green = 0.8 - (progress * 0.2)
            let blue = 0.4 + (progress * 0.35)
            return Color(red: red, green: green, blue: blue)
        } else if ageInDays <= 5 {
            // Neutral to cool transition
            let progress = (ageInDays - 2) / 3
            let red = 0.7 - (progress * 0.15)
            let green = 0.6 - (progress * 0.1)
            let blue = 0.75 - (progress * 0.15)
            return Color(red: red, green: green, blue: blue)
        } else {
            // Cool desaturated
            return Color(red: 0.55, green: 0.5, blue: 0.6)
        }
    }
    
    var body: some View {
        ZStack {
            // Slot background with depth
            RoundedRectangle(cornerRadius: 16)
                .fill(
                    LinearGradient(
                        gradient: Gradient(colors: [
                            Color(red: 0.25, green: 0.18, blue: 0.12),
                            Color(red: 0.35, green: 0.25, blue: 0.17)
                        ]),
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(
                            LinearGradient(
                                gradient: Gradient(colors: [
                                    Color(red: 0.6, green: 0.45, blue: 0.3).opacity(0.4),
                                    Color(red: 0.3, green: 0.2, blue: 0.1).opacity(0.6)
                                ]),
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 1
                        )
                )
            
            // Hover pulse border
            if isHovered {
                RoundedRectangle(cornerRadius: 16)
                    .stroke(
                        Color(red: 1.0, green: 0.85, blue: 0.6)
                            .opacity(0.6 + sin(pulsePhase * .pi * 2) * 0.3),
                        lineWidth: 2
                    )
                    .scaleEffect(1.02)
            }
            
            // Item content
            if let item = item {
                VStack(spacing: 12) {
                    // Item icon/representation
                    ZStack {
                        Circle()
                            .fill(itemColor)
                            .frame(width: 60, height: 60)
                        
                        // Warm amber glow for fresh items
                        if glowIntensity > 0 {
                            Circle()
                                .fill(
                                    RadialGradient(
                                        gradient: Gradient(colors: [
                                            Color(red: 1.0, green: 0.8, blue: 0.4).opacity(glowIntensity * 0.8),
                                            Color(red: 1.0, green: 0.7, blue: 0.3).opacity(glowIntensity * 0.4),
                                            Color.clear
                                        ]),
                                        center: .center,
                                        startRadius: 0,
                                        endRadius: 40
                                    )
                                )
                                .frame(width: 80, height: 80)
                                .blur(radius: 8)
                        }
                        
                        Text(String(item.title.prefix(1)))
                            .font(.system(size: 24, weight: .medium, design: .default))
                            .foregroundColor(Color.white.opacity(0.9))
                    }
                    
                    // Item title
                    Text(item.title)
                        .font(.system(size: 13, weight: .medium, design: .default))
                        .foregroundColor(Color.white.opacity(0.85))
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                    
                    // Subtle age indicator
                    HStack(spacing: 2) {
                        ForEach(0..<3, id: \.self) { dotIndex in
                            Circle()
                                .fill(
                                    ageInDays > Double(dotIndex * 2) ? 
                                    Color(red: 0.7, green: 0.5, blue: 0.3).opacity(0.6) :
                                    Color(red: 1.0, green: 0.8, blue: 0.5).opacity(0.8)
                                )
                                .frame(width: 4, height: 4)
                        }
                    }
                }
                .opacity(itemOpacity)
            } else {
                // Empty slot hint
                VStack(spacing: 8) {
                    Circle()
                        .stroke(
                            Color(red: 0.6, green: 0.45, blue: 0.3).opacity(0.3),
                            style: StrokeStyle(lineWidth: 2, dash: [6, 4])
                        )
                        .frame(width: 60, height: 60)
                    
                    Text("Drop here")
                        .font(.system(size: 11, weight: .regular, design: .default))
                        .foregroundColor(Color(red: 0.7, green: 0.55, blue: 0.4).opacity(0.6))
                }
            }
        }
        .frame(width: 140, height: 160)
    }
}

struct ShelfItem: Identifiable {
    let id = UUID()
    let title: String
    let lastUsed: Date
}