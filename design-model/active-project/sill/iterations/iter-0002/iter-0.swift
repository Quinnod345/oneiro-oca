struct ContentView: View {
    @State private var items: [SlotItem] = [
        SlotItem(title: "Project Alpha", createdAt: Calendar.current.date(byAdding: .hour, value: -2, to: Date()) ?? Date(), color: Color(red: 0.2, green: 0.6, blue: 0.9)),
        SlotItem(title: "Design Review", createdAt: Calendar.current.date(byAdding: .day, value: -1, to: Date()) ?? Date(), color: Color(red: 0.8, green: 0.3, blue: 0.4)),
        SlotItem(title: "Client Meeting", createdAt: Calendar.current.date(byAdding: .day, value: -3, to: Date()) ?? Date(), color: Color(red: 0.3, green: 0.7, blue: 0.5)),
        SlotItem(title: "Documentation", createdAt: Calendar.current.date(byAdding: .day, value: -6, to: Date()) ?? Date(), color: Color(red: 0.9, green: 0.6, blue: 0.2)),
        SlotItem(title: "Code Review", createdAt: Calendar.current.date(byAdding: .day, value: -8, to: Date()) ?? Date(), color: Color(red: 0.6, green: 0.4, blue: 0.8))
    ]
    @State private var dustOpacity: Double = 0.0
    
    var body: some View {
        ZStack {
            backgroundGradient
            
            VStack(spacing: 0) {
                Spacer()
                    .frame(height: 180)
                
                shelfBody
                
                Spacer()
            }
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            withAnimation(.easeInOut(duration: 3.0).repeatForever(autoreverses: true)) {
                dustOpacity = 0.4
            }
        }
    }
    
    var backgroundGradient: some View {
        LinearGradient(
            gradient: Gradient(colors: [
                Color(red: 0.96, green: 0.94, blue: 0.88),
                Color(red: 0.92, green: 0.88, blue: 0.78)
            ]),
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
    
    var shelfBody: some View {
        VStack(spacing: 0) {
            slotGrid
            shelfEdge
            shelfShadow
        }
    }
    
    var slotGrid: some View {
        HStack(spacing: 8) {
            ForEach(0..<8) { index in
                slotView(for: index)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 16)
        .padding(.bottom, 12)
        .background(shelfWoodGradient)
        .overlay(woodGrainTexture)
        .overlay(shelfWear)
    }
    
    func slotView(for index: Int) -> some View {
        ZStack {
            slotBackground
            
            if index < items.count {
                itemView(items[index])
            }
            
            slotBorder
        }
        .frame(width: 152, height: 240)
    }
    
    var slotBackground: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(
                LinearGradient(
                    gradient: Gradient(colors: [
                        Color(red: 0.74, green: 0.56, blue: 0.38).opacity(0.3),
                        Color(red: 0.68, green: 0.50, blue: 0.32).opacity(0.5)
                    ]),
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
    }
    
    var slotBorder: some View {
        RoundedRectangle(cornerRadius: 8)
            .stroke(
                LinearGradient(
                    gradient: Gradient(colors: [
                        Color(red: 0.60, green: 0.42, blue: 0.24).opacity(0.4),
                        Color(red: 0.50, green: 0.32, blue: 0.18).opacity(0.6)
                    ]),
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                lineWidth: 1.5
            )
    }
    
    func itemView(_ item: SlotItem) -> some View {
        ZStack {
            itemCard(item)
            ageOverlay(item)
            dustParticles(item)
        }
    }
    
    func itemCard(_ item: SlotItem) -> some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(decayedColor(item.color, decay: item.decayAmount))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(Color.white.opacity(0.2), lineWidth: 1)
            )
            .shadow(
                color: amberGlow(decay: item.decayAmount),
                radius: glowRadius(decay: item.decayAmount),
                x: 0,
                y: 2
            )
            .frame(width: 136, height: 200)
            .overlay(
                VStack {
                    Spacer()
                    Text(item.title)
                        .font(.system(size: 14, weight: .medium, design: .default))
                        .foregroundColor(textColor(decay: item.decayAmount))
                        .padding(.horizontal, 12)
                        .padding(.bottom, 16)
                        .multilineTextAlignment(.center)
                }
            )
    }
    
    func ageOverlay(_ item: SlotItem) -> some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(
                LinearGradient(
                    gradient: Gradient(colors: [
                        Color(red: 0.95, green: 0.85, blue: 0.60).opacity(item.decayAmount * 0.3),
                        Color(red: 0.90, green: 0.75, blue: 0.45).opacity(item.decayAmount * 0.5)
                    ]),
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .frame(width: 136, height: 200)
    }
    
    func dustParticles(_ item: SlotItem) -> some View {
        Group {
            if item.ageInDays >= 5 {
                ZStack {
                    ForEach(0..<20, id: \.self) { index in
                        Circle()
                            .fill(Color(red: 0.85, green: 0.75, blue: 0.60).opacity(0.6))
                            .frame(width: Double.random(in: 1...3), height: Double.random(in: 1...3))
                            .position(
                                x: Double.random(in: 10...126),
                                y: Double.random(in: 10...190)
                            )
                            .opacity(dustOpacity * (item.decayAmount * 0.8))
                    }
                }
                .frame(width: 136, height: 200)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
    }
    
    var shelfWoodGradient: some View {
        LinearGradient(
            gradient: Gradient(colors: [
                Color(red: 0.82, green: 0.64, blue: 0.46),
                Color(red: 0.77, green: 0.58, blue: 0.41),
                Color(red: 0.72, green: 0.53, blue: 0.36)
            ]),
            startPoint: .top,
            endPoint: .bottom
        )
    }
    
    var woodGrainTexture: some View {
        HStack(spacing: 0) {
            ForEach(0..<40, id: \.self) { _ in
                Rectangle()
                    .fill(Color(red: 0.65, green: 0.47, blue: 0.29).opacity(Double.random(in: 0.1...0.3)))
                    .frame(width: Double.random(in: 2...6), height: 280)
            }
        }
        .opacity(0.4)
    }
    
    var shelfWear: some View {
        VStack {
            Spacer()
            HStack {
                ForEach(0..<8) { index in
                    Ellipse()
                        .fill(Color(red: 0.60, green: 0.42, blue: 0.24).opacity(0.2))
                        .frame(width: 140, height: 8)
                        .blur(radius: 2)
                }
            }
            .padding(.bottom, 8)
        }
    }
    
    var shelfEdge: some View {
        Rectangle()
            .fill(
                LinearGradient(
                    gradient: Gradient(colors: [
                        Color(red: 0.68, green: 0.50, blue: 0.32),
                        Color(red: 0.58, green: 0.40, blue: 0.22),
                        Color(red: 0.48, green: 0.30, blue: 0.16)
                    ]),
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .frame(height: 24)
    }
    
    var shelfShadow: some View {
        LinearGradient(
            gradient: Gradient(colors: [
                Color.black.opacity(0.15),
                Color.black.opacity(0.05),
                Color.clear
            ]),
            startPoint: .top,
            endPoint: .bottom
        )
        .frame(height: 32)
    }
    
    func decayedColor(_ original: Color, decay: Double) -> Color {
        let baseRed: Double = 0.8
        let baseGreen: Double = 0.6
        let baseBlue: Double = 0.4
        
        let saturationMix: Double = 1.0 - (decay * 0.7)
        let yellowTint: Double = decay * 0.3
        
        return Color(
            red: baseRed * saturationMix + yellowTint * 0.9,
            green: baseGreen * saturationMix + yellowTint * 0.8,
            blue: baseBlue * saturationMix + yellowTint * 0.5
        )
    }
    
    func amberGlow(decay: Double) -> Color {
        let glowStrength: Double = 1.0 - decay
        return Color(red: 1.0, green: 0.6, blue: 0.2).opacity(glowStrength * 0.6)
    }
    
    func glowRadius(decay: Double) -> CGFloat {
        let baseRadius: CGFloat = 12.0
        let decayedRadius: CGFloat = 2.0
        return baseRadius * CGFloat(1.0 - decay) + decayedRadius * CGFloat(decay)
    }
    
    func textColor(decay: Double) -> Color {
        let freshColor: Color = Color.white
        let agedColor: Color = Color(red: 0.5, green: 0.4, blue: 0.3)
        
        let mixAmount: Double = 1.0 - decay
        return Color(
            red: 1.0 * mixAmount + 0.5 * decay,
            green: 1.0 * mixAmount + 0.4 * decay,
            blue: 1.0 * mixAmount + 0.3 * decay
        )
    }
}