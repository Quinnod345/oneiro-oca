struct TimeSlot: Identifiable {
    let id = UUID()
    let createdAt: Date
    let isFirstOpen: Bool
    
    var daysSinceCreated: Int {
        let calendar = Calendar.current
        let components = calendar.dateComponents([.day], from: createdAt, to: Date())
        return components.day ?? 0
    }
    
    var decayPhase: DecayPhase {
        if daysSinceCreated <= 3 {
            return .fresh
        } else if daysSinceCreated <= 7 {
            return .fading
        } else {
            return .expired
        }
    }
}

enum DecayPhase {
    case fresh
    case fading
    case expired
}

struct ContentView: View {
    @State private var slots: [TimeSlot] = [
        TimeSlot(createdAt: Date().addingTimeInterval(-86400), isFirstOpen: true),
        TimeSlot(createdAt: Date().addingTimeInterval(-345600), isFirstOpen: false),
        TimeSlot(createdAt: Date().addingTimeInterval(-518400), isFirstOpen: false)
    ]
    
    @State private var animationTrigger: Bool = false
    
    var body: some View {
        VStack(spacing: 16) {
            Text("Ephemeral")
                .font(.system(size: 24, weight: .light, design: .serif))
                .foregroundColor(Color(red: 0.2, green: 0.15, blue: 0.1))
                .padding(.top, 20)
            
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4), spacing: 12) {
                ForEach(0..<8) { index in
                    if index < slots.count {
                        TimeSlotView(slot: slots[index], animationTrigger: animationTrigger)
                    } else {
                        EmptySlotView()
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 20)
        }
        .frame(width: 400, height: 320)
        .background(
            Color(red: 0.98, green: 0.96, blue: 0.94)
                .overlay(
                    LinearGradient(
                        colors: [
                            Color(red: 1.0, green: 0.98, blue: 0.94),
                            Color(red: 0.96, green: 0.94, blue: 0.90)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
        )
        .onAppear {
            animationTrigger = true
        }
    }
}

struct TimeSlotView: View {
    let slot: TimeSlot
    let animationTrigger: Bool
    
    @State private var pulseScale: Double = 1.0
    @State private var pulseOpacity: Double = 0.0
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(
                    Color(red: 0.95, green: 0.93, blue: 0.89)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(borderColor, lineWidth: borderWidth)
                )
                .opacity(slotOpacity)
            
            if slot.decayPhase == .fading {
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(
                        Color(red: 0.9, green: 0.6, blue: 0.2).opacity(0.6),
                        lineWidth: 1
                    )
                    .blur(radius: 2)
                    .scaleEffect(1.05)
                
                DecayArcView(daysRemaining: 7 - slot.daysSinceCreated)
            }
            
            if slot.isFirstOpen {
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(
                        Color(red: 0.8, green: 0.5, blue: 0.2).opacity(pulseOpacity),
                        lineWidth: 2
                    )
                    .scaleEffect(pulseScale)
            }
        }
        .frame(width: 80, height: 60)
        .onAppear {
            if slot.isFirstOpen {
                withAnimation(
                    .spring(response: 1.2, dampingFraction: 0.6)
                    .delay(0.3)
                ) {
                    pulseScale = 1.08
                    pulseOpacity = 0.8
                }
                
                withAnimation(
                    .spring(response: 1.5, dampingFraction: 0.7)
                    .delay(1.5)
                ) {
                    pulseScale = 1.0
                    pulseOpacity = 0.0
                }
            }
        }
    }
    
    private var slotOpacity: Double {
        switch slot.decayPhase {
        case .fresh: return 1.0
        case .fading: return 0.45
        case .expired: return 0.15
        }
    }
    
    private var borderColor: Color {
        switch slot.decayPhase {
        case .fresh: return Color(red: 0.7, green: 0.4, blue: 0.15)
        case .fading: return Color(red: 0.6, green: 0.35, blue: 0.12)
        case .expired: return Color(red: 0.5, green: 0.45, blue: 0.4)
        }
    }
    
    private var borderWidth: Double {
        switch slot.decayPhase {
        case .fresh: return 1.5
        case .fading: return 0.5
        case .expired: return 0.3
        }
    }
}

struct DecayArcView: View {
    let daysRemaining: Int
    
    var body: some View {
        ZStack {
            Circle()
                .trim(from: 0, to: progress)
                .stroke(
                    Color(red: 0.85, green: 0.55, blue: 0.2),
                    style: StrokeStyle(lineWidth: 1.5, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .frame(width: 16, height: 16)
        }
        .position(x: 70, y: 10)
    }
    
    private var progress: Double {
        Double(daysRemaining) / 4.0
    }
}

struct EmptySlotView: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Color(red: 0.92, green: 0.90, blue: 0.86))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(
                        Color(red: 0.85, green: 0.82, blue: 0.78),
                        lineWidth: 0.5,
                        antialiased: true
                    )
            )
            .frame(width: 80, height: 60)
    }
}