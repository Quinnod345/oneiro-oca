struct ContentView: View {
    @State private var slots: [TimeSlot] = [
        TimeSlot(title: "Morning Pages", createdAt: Date().addingTimeInterval(-86400 * 3), lastUsed: Date().addingTimeInterval(-3600 * 2)),
        TimeSlot(title: "Design Review", createdAt: Date().addingTimeInterval(-86400 * 1), lastUsed: Date().addingTimeInterval(-3600 * 8)),
        TimeSlot(title: "Weekly Planning", createdAt: Date().addingTimeInterval(-86400 * 7), lastUsed: Date().addingTimeInterval(-3600 * 72)),
        TimeSlot(title: "Code Review", createdAt: Date().addingTimeInterval(-86400 * 2), lastUsed: Date().addingTimeInterval(-3600 * 1)),
        TimeSlot(title: "Client Call", createdAt: Date().addingTimeInterval(-86400 * 5), lastUsed: Date().addingTimeInterval(-3600 * 120))
    ]
    
    var body: some View {
        ZStack {
            // Warm wood background with depth
            LinearGradient(
                colors: [
                    Color(red: 0.82, green: 0.71, blue: 0.55),
                    Color(red: 0.76, green: 0.64, blue: 0.48),
                    Color(red: 0.71, green: 0.58, blue: 0.42)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .overlay(
                // Wood grain texture
                Canvas { context, size in
                    for y in stride(from: 0, to: size.height, by: 3) {
                        let opacity = Double.random(in: 0.02...0.08)
                        context.opacity = opacity
                        context.fill(
                            Path(CGRect(x: 0, y: y, width: size.width, height: 1.5)),
                            with: .color(Color(red: 0.45, green: 0.32, blue: 0.18))
                        )
                    }
                }
            )
            
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 16) {
                    ForEach(slots) { slot in
                        SlotCard(slot: slot)
                            .onTapGesture {
                                updateSlotUsage(slot)
                            }
                    }
                    
                    if slots.count < 8 {
                        AddSlotButton {
                            addNewSlot()
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 32)
            }
        }
        .frame(width: 1440, height: 900)
    }
    
    private func updateSlotUsage(_ slot: TimeSlot) {
        if let index = slots.firstIndex(where: { $0.id == slot.id }) {
            slots[index].lastUsed = Date()
        }
    }
    
    private func addNewSlot() {
        let newSlot = TimeSlot(
            title: "New Activity",
            createdAt: Date(),
            lastUsed: Date()
        )
        slots.append(newSlot)
    }
}

struct SlotCard: View {
    let slot: TimeSlot
    
    var body: some View {
        ZStack {
            // Base card with warm material feel
            RoundedRectangle(cornerRadius: 12)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.94, green: 0.89, blue: 0.82),
                            Color(red: 0.89, green: 0.84, blue: 0.76)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    // Fine grain texture
                    Canvas { context, size in
                        for x in stride(from: 0, to: size.width, by: 2) {
                            for y in stride(from: 0, to: size.height, by: 2) {
                                if Bool.random() {
                                    let opacity = Double.random(in: 0.01...0.04)
                                    context.opacity = opacity
                                    context.fill(
                                        Path(CGRect(x: x, y: y, width: 1, height: 1)),
                                        with: .color(Color(red: 0.65, green: 0.52, blue: 0.38))
                                    )
                                }
                            }
                        }
                    }
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.78, green: 0.67, blue: 0.54).opacity(0.6),
                                    Color(red: 0.85, green: 0.76, blue: 0.65).opacity(0.3)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 1
                        )
                )
                .shadow(
                    color: Color(red: 0.45, green: 0.32, blue: 0.18).opacity(0.15),
                    radius: 8,
                    x: 0,
                    y: 4
                )
            
            // Age-based glow overlay for fresh items
            if slot.freshnessRatio > 0.7 {
                RoundedRectangle(cornerRadius: 12)
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(red: 1.0, green: 0.84, blue: 0.35).opacity(slot.freshnessRatio * 0.12),
                                Color.clear
                            ],
                            center: .center,
                            startRadius: 0,
                            endRadius: 120
                        )
                    )
                    .overlay(
                        // Inner warm glow
                        RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(
                                Color(red: 1.0, green: 0.76, blue: 0.28).opacity(slot.freshnessRatio * 0.25),
                                lineWidth: 1
                            )
                            .blur(radius: 2)
                    )
            }
            
            // Content with age-based styling
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(slot.title)
                        .font(.system(size: 18, weight: .medium, design: .default))
                        .foregroundColor(textColor)
                    
                    Spacer()
                    
                    Circle()
                        .fill(freshnessIndicatorColor)
                        .frame(width: 8, height: 8)
                        .opacity(slot.freshnessRatio > 0.3 ? 1.0 : 0.6)
                }
                
                Text(timeAgoText)
                    .font(.system(size: 13, weight: .regular, design: .default))
                    .foregroundColor(subtextColor)
            }
            .padding(20)
        }
        .opacity(cardOpacity)
        .saturation(cardSaturation)
        .frame(height: 80)
    }
    
    private var textColor: Color {
        let freshness = slot.freshnessRatio
        if freshness > 0.7 {
            // Fresh: warm dark brown with golden undertones
            return Color(red: 0.35, green: 0.25, blue: 0.15)
        } else if freshness > 0.3 {
            // Medium: neutral brown
            return Color(red: 0.45, green: 0.35, blue: 0.25)
        } else {
            // Aged: cool grey-brown
            return Color(red: 0.55, green: 0.52, blue: 0.48)
        }
    }
    
    private var subtextColor: Color {
        let freshness = slot.freshnessRatio
        return textColor.opacity(freshness > 0.3 ? 0.7 : 0.5)
    }
    
    private var freshnessIndicatorColor: Color {
        let freshness = slot.freshnessRatio
        if freshness > 0.7 {
            return Color(red: 1.0, green: 0.76, blue: 0.28) // Warm amber
        } else if freshness > 0.3 {
            return Color(red: 0.82, green: 0.71, blue: 0.55) // Neutral wood tone
        } else {
            return Color(red: 0.65, green: 0.65, blue: 0.65) // Cool grey
        }
    }
    
    private var cardOpacity: Double {
        let freshness = slot.freshnessRatio
        return max(0.7, 0.7 + (freshness * 0.3))
    }
    
    private var cardSaturation: Double {
        let freshness = slot.freshnessRatio
        return max(0.6, 0.6 + (freshness * 0.4))
    }
    
    private var timeAgoText: String {
        let hours = slot.ageInHours
        if hours < 1 {
            return "Just now"
        } else if hours < 24 {
            let h = Int(hours)
            return "\(h) hour\(h == 1 ? "" : "s") ago"
        } else {
            let days = Int(hours / 24)
            return "\(days) day\(days == 1 ? "" : "s") ago"
        }
    }
}

struct AddSlotButton: View {
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(
                        Color(red: 0.89, green: 0.84, blue: 0.76).opacity(0.6)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(
                                Color(red: 0.78, green: 0.67, blue: 0.54).opacity(0.4),
                                lineWidth: 2,
                                antialiased: true
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .strokeBorder(
                                        Color(red: 0.78, green: 0.67, blue: 0.54).opacity(0.2),
                                        lineWidth: 1,
                                        antialiased: true
                                    )
                                    .blur(radius: 1)
                            )
                    )
                
                Image(systemName: "plus")
                    .font(.system(size: 20, weight: .medium, design: .default))
                    .foregroundColor(Color(red: 0.65, green: 0.52, blue: 0.38))
            }
        }
        .buttonStyle(PlainButtonStyle())
        .frame(height: 80)
    }
}