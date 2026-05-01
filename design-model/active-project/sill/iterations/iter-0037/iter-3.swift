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
            
            VStack(spacing: 40) {
                Text("Ephemeral")
                    .font(.custom("SF Pro Display", size: 32))
                    .fontWeight(.semibold)
                    .tracking(-0.64)
                    .foregroundColor(Color.white)
                    .padding(.top, 32)
                
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 32), count: 3), spacing: 32) {
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
    
    @State private var appeared: Bool = false
    @State private var decayProgress: Double = 0.0
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.clear)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.white.opacity(0.2), lineWidth: 1)
                )
                .scaleEffect(appeared ? scaleTransform : 0.8)
                .opacity(appeared ? opacityTransform : 0)
            
            VStack(spacing: 8) {
                DecayRing(phase: slot.decayPhase, progress: decayProgress)
                
                Text(relativeDateString)
                    .font(.custom("SF Pro Text", size: 10))
                    .fontWeight(.medium)
                    .foregroundColor(Color.white.opacity(textOpacity))
            }
        }
        .frame(width: 100, height: 76)
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.7, blendDuration: 0).delay(0.1)) {
                appeared = true
            }
            
            withAnimation(.easeInOut(duration: 2.0).delay(0.2)) {
                decayProgress = 1.0
            }
        }
    }
    
    private var scaleTransform: Double {
        switch slot.decayPhase {
        case .fresh: return 1.0
        case .fading: return 0.94
        case .expired: return 0.86
        }
    }
    
    private var opacityTransform: Double {
        switch slot.decayPhase {
        case .fresh: return 1.0
        case .fading: return 0.65
        case .expired: return 0.25
        }
    }
    
    private var textOpacity: Double {
        switch slot.decayPhase {
        case .fresh: return 0.9
        case .fading: return 0.6
        case .expired: return 0.3
        }
    }
    
    private var relativeDateString: String {
        let days = slot.daysSinceCreated
        switch days {
        case 0: return "Now"
        case 1: return "1 day"
        default: return "\(days) days"
        }
    }
}

struct DecayRing: View {
    let phase: DecayPhase
    let progress: Double
    
    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.15), lineWidth: 2)
                .frame(width: 24, height: 24)
            
            Circle()
                .trim(from: 0, to: ringProgress * progress)
                .stroke(ringColor, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                .frame(width: 24, height: 24)
                .rotationEffect(.degrees(-90))
                .opacity(ringOpacity)
        }
    }
    
    private var ringProgress: Double {
        switch phase {
        case .fresh: return 1.0
        case .fading: return 0.4
        case .expired: return 0.05
        }
    }
    
    private var ringColor: Color {
        Color.white
    }
    
    private var ringOpacity: Double {
        switch phase {
        case .fresh: return 1.0
        case .fading: return 0.6
        case .expired: return 0.2
        }
    }
}

struct EmptySlotView: View {
    @State private var appeared: Bool = false
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.clear)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                )
                .opacity(appeared ? 0.4 : 0)
        }
        .frame(width: 100, height: 76)
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.7, blendDuration: 0).delay(0.3)) {
                appeared = true
            }
        }
    }
}