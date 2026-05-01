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
            
            VStack(spacing: 20) {
                Text("Ephemeral")
                    .font(.system(size: 28, weight: .medium, design: .default))
                    .foregroundColor(.primary)
                    .padding(.top, 24)
                
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: 4), spacing: 16) {
                    ForEach(0..<8) { index in
                        if index < slots.count {
                            TimeSlotView(slot: slots[index], animationTrigger: animationTrigger)
                        } else {
                            EmptySlotView()
                        }
                    }
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 24)
            }
        }
        .frame(width: 440, height: 320)
        .onAppear {
            animationTrigger = true
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
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(.regularMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(.quaternary, lineWidth: 1)
                )
                .scaleEffect(scaleTransform)
                .opacity(opacityTransform)
            
            if slot.decayPhase == .fading || slot.decayPhase == .expired {
                DecayVisualization(phase: slot.decayPhase, daysRemaining: max(0, 7 - slot.daysSinceCreated))
            }
            
            if slot.isFirstOpen {
                RoundedRectangle(cornerRadius: 12)
                    .stroke(.accent, lineWidth: 2)
                    .scaleEffect(pulseScale)
                    .opacity(0.8 - (pulseScale - 1.0) * 4)
            }
        }
        .frame(width: 88, height: 68)
        .onAppear {
            if slot.isFirstOpen {
                withAnimation(.easeInOut(duration: 2.0).repeatForever(autoreverses: true)) {
                    pulseScale = 1.1
                }
            }
            
            withAnimation(.easeInOut(duration: 1.5).delay(Double.random(in: 0...0.5))) {
                decayAnimation = 1.0
            }
        }
    }
    
    private var scaleTransform: Double {
        let baseScale: Double
        switch slot.decayPhase {
        case .fresh: baseScale = 1.0
        case .fading: baseScale = 0.95
        case .expired: baseScale = 0.85
        }
        return baseScale * (1.0 - (1.0 - decayAnimation) * 0.2)
    }
    
    private var opacityTransform: Double {
        let baseOpacity: Double
        switch slot.decayPhase {
        case .fresh: baseOpacity = 1.0
        case .fading: baseOpacity = 0.7
        case .expired: baseOpacity = 0.3
        }
        return baseOpacity * decayAnimation
    }
}

struct DecayVisualization: View {
    let phase: DecayPhase
    let daysRemaining: Int
    
    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<4, id: \.self) { index in
                Circle()
                    .fill(dotColor(for: index))
                    .frame(width: 6, height: 6)
                    .scaleEffect(dotScale(for: index))
                    .animation(.easeInOut(duration: 0.8).delay(Double(index) * 0.1), value: phase)
            }
        }
        .position(x: 74, y: 14)
    }
    
    private func dotColor(for index: Int) -> Color {
        switch phase {
        case .fresh:
            return .accent
        case .fading:
            return index < daysRemaining ? .accent : .secondary.opacity(0.3)
        case .expired:
            return .secondary.opacity(0.2)
        }
    }
    
    private func dotScale(for index: Int) -> Double {
        switch phase {
        case .fresh:
            return 1.0
        case .fading:
            return index < daysRemaining ? 1.0 : 0.6
        case .expired:
            return 0.4
        }
    }
}

struct EmptySlotView: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(.ultraThinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(.quaternary, lineWidth: 1)
            )
            .frame(width: 88, height: 68)
            .opacity(0.5)
    }
}