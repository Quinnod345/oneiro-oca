struct ContentView: View {
    @State private var slots: [TimeSlot] = [
        TimeSlot(createdAt: Date().addingTimeInterval(-86400), isFirstOpen: true),
        TimeSlot(createdAt: Date().addingTimeInterval(-345600), isFirstOpen: false),
        TimeSlot(createdAt: Date().addingTimeInterval(-518400), isFirstOpen: false)
    ]
    
    @State private var animationTrigger: Bool = false
    
    var body: some View {
        ZStack {
            VisualEffectBlur(material: .hudWindow, blendingMode: .behindWindow)
            
            VStack(spacing: 28) {
                Text("Ephemeral")
                    .font(.custom("SF Pro Display", size: 32))
                    .fontWeight(.semibold)
                    .tracking(-0.64)
                    .foregroundColor(Color(red: 0.1, green: 0.1, blue: 0.12))
                    .padding(.top, 32)
                
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 20), count: 3), spacing: 20) {
                    ForEach(0..<6) { index in
                        if index < slots.count {
                            TimeSlotView(slot: slots[index], animationTrigger: animationTrigger)
                        } else {
                            EmptySlotView()
                        }
                    }
                }
                .padding(.horizontal, 40)
                .padding(.bottom, 32)
            }
        }
        .frame(width: 480, height: 340)
        .onAppear {
            withAnimation(.spring(response: 0.6, dampingFraction: 0.8, blendDuration: 0)) {
                animationTrigger = true
            }
        }
    }
}

struct VisualEffectBlur: NSViewRepresentable {
    var material: NSVisualEffectView.Material
    var blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let visualEffectView = NSVisualEffectView()
        visualEffectView.material = material
        visualEffectView.blendingMode = blendingMode
        visualEffectView.state = NSVisualEffectView.State.active
        return visualEffectView
    }
    
    func updateNSView(_ visualEffectView: NSVisualEffectView, context: Context) {
        visualEffectView.material = material
        visualEffectView.blendingMode = blendingMode
    }
}

struct TimeSlotView: View {
    let slot: TimeSlot
    let animationTrigger: Bool
    
    @State private var pulseScale: Double = 1.0
    @State private var decayAnimation: Double = 0.0
    @State private var appeared: Bool = false
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 16)
                .fill(.regularMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(Color(red: 0.8, green: 0.8, blue: 0.82, opacity: 0.6), lineWidth: 1)
                )
                .scaleEffect(appeared ? scaleTransform : 0.8)
                .opacity(appeared ? opacityTransform : 0)
            
            VStack(spacing: 8) {
                if slot.decayPhase == .fading || slot.decayPhase == .expired {
                    DecayVisualization(phase: slot.decayPhase, daysRemaining: max(0, 7 - slot.daysSinceCreated))
                }
                
                Text(relativeDateString)
                    .font(.custom("SF Pro Text", size: 11))
                    .fontWeight(.medium)
                    .foregroundColor(Color(red: 0.4, green: 0.4, blue: 0.44))
            }
            
            if slot.isFirstOpen {
                RoundedRectangle(cornerRadius: 16)
                    .stroke(Color(red: 0.0, green: 0.48, blue: 1.0), lineWidth: 2.5)
                    .scaleEffect(pulseScale)
                    .opacity(0.9 - (pulseScale - 1.0) * 3)
            }
        }
        .frame(width: 120, height: 88)
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.7, blendDuration: 0)) {
                appeared = true
            }
            
            if slot.isFirstOpen {
                withAnimation(.spring(response: 1.8, dampingFraction: 0.4, blendDuration: 0).repeatForever(autoreverses: true)) {
                    pulseScale = 1.08
                }
            }
            
            withAnimation(.spring(response: 1.2, dampingFraction: 0.8, blendDuration: 0)) {
                decayAnimation = 1.0
            }
        }
    }
    
    private var scaleTransform: Double {
        let baseScale: Double
        switch slot.decayPhase {
        case .fresh: baseScale = 1.0
        case .fading: baseScale = 0.96
        case .expired: baseScale = 0.88
        }
        return baseScale
    }
    
    private var opacityTransform: Double {
        switch slot.decayPhase {
        case .fresh: return 1.0
        case .fading: return 0.75
        case .expired: return 0.35
        }
    }
    
    private var relativeDateString: String {
        let days = slot.daysSinceCreated
        switch days {
        case 0: return "Today"
        case 1: return "Yesterday"
        default: return "\(days) days ago"
        }
    }
}

struct DecayVisualization: View {
    let phase: DecayPhase
    let daysRemaining: Int
    
    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<5, id: \.self) { index in
                Circle()
                    .fill(dotColor(for: index))
                    .frame(width: 8, height: 8)
                    .scaleEffect(dotScale(for: index))
                    .animation(.spring(response: 0.6, dampingFraction: 0.7, blendDuration: 0), value: phase)
            }
        }
    }
    
    private func dotColor(for index: Int) -> Color {
        switch phase {
        case .fresh:
            return Color(red: 0.0, green: 0.48, blue: 1.0)
        case .fading:
            return index < daysRemaining ? Color(red: 1.0, green: 0.58, blue: 0.0) : Color(red: 0.7, green: 0.7, blue: 0.72, opacity: 0.4)
        case .expired:
            return Color(red: 0.7, green: 0.7, blue: 0.72, opacity: 0.25)
        }
    }
    
    private func dotScale(for index: Int) -> Double {
        switch phase {
        case .fresh:
            return 1.0
        case .fading:
            return index < daysRemaining ? 1.0 : 0.65
        case .expired:
            return 0.5
        }
    }
}

struct EmptySlotView: View {
    @State private var appeared: Bool = false
    
    var body: some View {
        RoundedRectangle(cornerRadius: 16)
            .fill(.ultraThinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(Color(red: 0.8, green: 0.8, blue: 0.82, opacity: 0.3), lineWidth: 1)
            )
            .frame(width: 120, height: 88)
            .scaleEffect(appeared ? 1.0 : 0.8)
            .opacity(appeared ? 0.4 : 0)
            .onAppear {
                withAnimation(.spring(response: 0.7, dampingFraction: 0.8, blendDuration: 0).delay(0.1)) {
                    appeared = true
                }
            }
    }
}