struct ContentView: View {
    @State private var slots: [TimeSlot] = [
        TimeSlot(title: "Morning Pages", createdAt: Date().addingTimeInterval(-86400 * 3), lastUsed: Date().addingTimeInterval(-3600 * 2)),
        TimeSlot(title: "Design Review", createdAt: Date().addingTimeInterval(-86400 * 1), lastUsed: Date().addingTimeInterval(-3600 * 8)),
        TimeSlot(title: "Weekly Planning", createdAt: Date().addingTimeInterval(-86400 * 7), lastUsed: Date().addingTimeInterval(-3600 * 72)),
        TimeSlot(title: "Code Review", createdAt: Date().addingTimeInterval(-86400 * 2), lastUsed: Date().addingTimeInterval(-3600 * 1)),
        TimeSlot(title: "Client Call", createdAt: Date().addingTimeInterval(-86400 * 5), lastUsed: Date().addingTimeInterval(-3600 * 120))
    ]
    
    @State private var selectedSlot: TimeSlot?
    @State private var animatedIndices: Set<UUID> = []
    
    var sortedSlots: [TimeSlot] {
        slots.sorted { $0.lastUsed > $1.lastUsed }
    }
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
            
            VStack(spacing: 0) {
                HeaderView(totalSlots: slots.count)
                
                TimelineView(slots: sortedSlots, animatedIndices: $animatedIndices) { slot in
                    updateSlotUsage(slot)
                } onDelete: { slot in
                    deleteSlot(slot)
                }
                
                if slots.count < 8 {
                    CompactAddButton {
                        addNewSlot()
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 16)
                }
            }
        }
        .onAppear {
            for (index, slot) in sortedSlots.enumerated() {
                withAnimation(.spring(response: 0.8, dampingFraction: 0.8, blendDuration: 0).delay(Double(index) * 0.1)) {
                    animatedIndices.insert(slot.id)
                }
            }
        }
    }
    
    private func updateSlotUsage(_ slot: TimeSlot) {
        if let index = slots.firstIndex(where: { $0.id == slot.id }) {
            slots[index].lastUsed = Date()
        }
    }
    
    private func deleteSlot(_ slot: TimeSlot) {
        withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
            slots.removeAll { $0.id == slot.id }
        }
    }
    
    private func addNewSlot() {
        let newSlot = TimeSlot(
            title: "New Activity",
            createdAt: Date(),
            lastUsed: Date()
        )
        withAnimation(.spring(response: 0.8, dampingFraction: 0.7)) {
            slots.append(newSlot)
        }
    }
}

struct HeaderView: View {
    let totalSlots: Int
    @State private var heatmapData = Array(0..<7).map { _ in Double.random(in: 0...1) }
    
    var body: some View {
        VStack(spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text("Activity Timeline")
                            .font(.system(.title2, design: .default, weight: .semibold))
                            .foregroundStyle(.primary)
                        
                        PulseIndicator()
                    }
                    
                    HStack(spacing: 4) {
                        Text("\(totalSlots)")
                            .font(.system(.caption, design: .monospaced, weight: .bold))
                            .foregroundStyle(.accent)
                        
                        Text("tracked activities")
                            .font(.system(.caption, design: .default, weight: .medium))
                            .foregroundStyle(.secondary)
                    }
                }
                
                Spacer()
                
                ActivityHeatMap(data: heatmapData)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            
            DecayPreview()
            
            Divider()
                .opacity(0.3)
        }
    }
}

struct PulseIndicator: View {
    @State private var pulsing = false
    
    var body: some View {
        Circle()
            .fill(.green)
            .frame(width: 6, height: 6)
            .scaleEffect(pulsing ? 1.2 : 0.8)
            .opacity(pulsing ? 0.6 : 1.0)
            .animation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true), value: pulsing)
            .onAppear { pulsing = true }
    }
}

struct DecayPreview: View {
    @State private var animationPhase = 0.0
    
    var body: some View {
        HStack(spacing: 12) {
            Text("Activity Decay")
                .font(.system(.caption2, design: .default, weight: .medium))
                .foregroundStyle(.tertiary)
            
            HStack(spacing: 2) {
                ForEach(0..<20, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(decayGradient(position: Double(index) / 19.0))
                        .frame(width: 3, height: 4)
                        .scaleEffect(y: sin(animationPhase + Double(index) * 0.3) * 0.3 + 1.0)
                }
            }
            
            Spacer()
        }
        .padding(.horizontal, 20)
        .onAppear {
            withAnimation(.linear(duration: 3).repeatForever(autoreverses: false)) {
                animationPhase = .pi * 4
            }
        }
    }
    
    private func decayGradient(position: Double) -> Color {
        let intensity = max(0.2, 1.0 - position)
        return Color.accentColor.opacity(intensity)
    }
}

struct ActivityHeatMap: View {
    let data: [Double]
    @State private var animateIntensity = false
    
    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text("7d")
                .font(.system(.caption2, design: .monospaced, weight: .medium))
                .foregroundStyle(.tertiary)
            
            HStack(spacing: 2) {
                ForEach(Array(data.enumerated()), id: \.offset) { index, intensity in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(intensityGradient(intensity: intensity))
                        .frame(width: 8, height: 12)
                        .scaleEffect(animateIntensity ? 1.0 : 0.1)
                        .animation(.spring(response: 0.6, dampingFraction: 0.7).delay(Double(index) * 0.05), value: animateIntensity)
                }
            }
        }
        .onAppear {
            animateIntensity = true
        }
    }
    
    private func intensityGradient(intensity: Double) -> LinearGradient {
        LinearGradient(
            colors: [
                Color.accentColor.opacity(0.3 + intensity * 0.4),
                Color.accentColor.opacity(0.1 + intensity * 0.6)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}

struct TimelineView: View {
    let slots: [TimeSlot]
    @Binding var animatedIndices: Set<UUID>
    let onTap: (TimeSlot) -> Void
    let onDelete: (TimeSlot) -> Void
    
    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(spacing: 1) {
                ForEach(Array(slots.enumerated()), id: \.element.id) { index, slot in
                    TimelineRowView(
                        slot: slot,
                        isFirst: index == 0,
                        isLast: index == slots.count - 1,
                        isAnimated: animatedIndices.contains(slot.id)
                    ) {
                        onTap(slot)
                    } onDelete: {
                        onDelete(slot)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 8)
        }
    }
}

struct TimelineRowView: View {
    let slot: TimeSlot
    let isFirst: Bool
    let isLast: Bool
    let isAnimated: Bool
    let onTap: () -> Void
    let onDelete: () -> Void
    
    @State private var isPressed = false
    @State private var momentumAnimation = false
    
    var freshnessMetrics: (scale: Double, blur: Double, gradient: LinearGradient) {
        let freshness = slot.freshnessRatio
        let scale = 0.85 + freshness * 0.15
        let blur = (1.0 - freshness) * 2.0
        
        let colors: [Color]
        if freshness > 0.7 {
            colors = [.green.opacity(0.8), .blue.opacity(0.6)]
        } else if freshness > 0.4 {
            colors = [.orange.opacity(0.7), .yellow.opacity(0.5)]
        } else {
            colors = [.red.opacity(0.6), .gray.opacity(0.4)]
        }
        
        let gradient = LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing)
        return (scale, blur, gradient)
    }
    
    var body: some View {
        HStack(spacing: 12) {
            TimelineIndicator(
                freshness: slot.freshnessRatio,
                isFirst: isFirst,
                isLast: isLast,
                momentumPhase: momentumAnimation
            )
            
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(slot.title)
                        .font(.system(.body, design: .default, weight: .medium))
                        .foregroundStyle(.primary)
                    
                    Spacer()
                    
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(formatRelativeTime(slot.lastUsed))
                            .font(.system(.caption, design: .monospaced, weight: .regular))
                            .foregroundStyle(.secondary)
                        
                        StreakIndicator(freshness: slot.freshnessRatio)
                    }
                }
                
                UsageBar(freshness: slot.freshnessRatio, animated: isAnimated)
                
                DecayCurve(freshness: slot.freshnessRatio, animated: isAnimated)
            }
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .scaleEffect(freshnessMetrics.scale)
        .blur(radius: freshnessMetrics.blur)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(freshnessMetrics.gradient.opacity(0.1))
                .scaleEffect(isPressed ? 1.02 : 1.0)
        )
        .scaleEffect(isPressed ? 0.98 : 1.0)
        .offset(x: isAnimated ? 0 : -50)
        .opacity(isAnimated ? 1.0 : 0.0)
        .animation(.spring(response: 0.6, dampingFraction: 0.8), value: isPressed)
        .animation(.spring(response: 0.8, dampingFraction: 0.7), value: isAnimated)
        .onTapGesture {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
                isPressed = true
                momentumAnimation.toggle()
            }
            
            withAnimation(.spring(response: 0.4, dampingFraction: 0.8).delay(0.1)) {
                isPressed = false
            }
            
            onTap()
        }
        .onLongPressGesture {
            onDelete()
        }
    }
}

struct StreakIndicator: View {
    let freshness: Double
    
    var streakLevel: Int {
        if freshness > 0.8 { return 3 }
        else if freshness > 0.5 { return 2 }
        else if freshness > 0.2 { return 1 }
        else { return 0 }
    }
    
    var body: some View {
        HStack(spacing: 1) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(index < streakLevel ? Color.accentColor : Color.gray.opacity(0.3))
                    .frame(width: 3, height: 3)
            }
        }
    }
}

struct TimelineIndicator: View {
    let freshness: Double
    let isFirst: Bool
    let isLast: Bool
    let momentumPhase: Bool
    
    var body: some View {
        VStack(spacing: 0) {
            if !isFirst {
                Rectangle()
                    .fill(.tertiary.opacity(0.5))
                    .frame(width: 2, height: 12)
            }
            
            ZStack {
                Circle()
                    .fill(RadialGradient(
                        colors: [
                            Color.accentColor.opacity(freshness),
                            Color.accentColor.opacity(freshness * 0.3)
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: 8
                    ))
                    .frame(width: 12, height: 12)
                    .scaleEffect(momentumPhase ? 1.3 : 1.0)
                    .animation(.spring(response: 0.4, dampingFraction: 0.6), value: momentumPhase)
                
                Circle()
                    .fill(.white.opacity(0.8))
                    .frame(width: 4, height: 4)
            }
            
            if !isLast {
                Rectangle()
                    .fill(.tertiary.opacity(0.5))
                    .frame(width: 2, height: 12)
            }
        }
    }
}

struct UsageBar: View {
    let freshness: Double
    let animated: Bool
    @State private var animateWidth = false
    
    var body: some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2)
                .fill(.quaternary)
                .frame(height: 3)
            
            RoundedRectangle(cornerRadius: 2)
                .fill(LinearGradient(
                    colors: [
                        Color.accentColor.opacity(0.8),
                        Color.accentColor.opacity(0.4)
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                ))
                .frame(width: animateWidth ? nil : 0, height: 3)
                .frame(maxWidth: .infinity, alignment: .leading)
                .scaleEffect(x: animateWidth ? freshness : 0, anchor: .leading)
        }
        .onAppear {
            if animated {
                withAnimation(.easeOut(duration: 1.0).delay(0.3)) {
                    animateWidth = true
                }
            } else {
                animateWidth = true
            }
        }
    }
}

struct DecayCurve: View {
    let freshness: Double
    let animated: Bool
    @State private var animateDecay = false
    
    private let points: [CGPoint] = [
        CGPoint(x: 0, y: 0.8),
        CGPoint(x: 0.2, y: 0.6),
        CGPoint(x: 0.5, y: 0.4),
        CGPoint(x: 0.8, y: 0.2),
        CGPoint(x: 1.0, y: 0.1)
    ]
    
    var body: some View {
        Canvas { context, size in
            var path = Path()
            
            for (index, point) in points.enumerated() {
                let x = point.x * size.width
                let y = size.height - (point.y * freshness * size.height)
                
                if index == 0 {
                    path.move(to: CGPoint(x: x, y: y))
                } else {
                    path.addLine(to: CGPoint(x: x, y: y))
                }
            }
            
            context.stroke(
                path,
                with: .color(.accentColor.opacity(animateDecay ? 0.6 : 0.0)),
                style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: [2, 2])
            )
        }
        .frame(height: 20)
        .onAppear {
            if animated {
                withAnimation(.easeInOut(duration: 1.5).delay(0.5)) {
                    animateDecay = true
                }
            } else {
                animateDecay = true
            }
        }
    }
}

struct CompactAddButton: View {
    let action: () -> Void
    @State private var isPressed = false
    
    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: "plus")
                    .font(.system(.body, design: .default, weight: .medium))
                
                Text("Add Activity")
                    .font(.system(.body, design: .default, weight: .medium))
            }
            .foregroundStyle(.accent)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(.accent.opacity(0.1))
                    .scaleEffect(isPressed ? 1.05 : 1.0)
            )
        }
        .buttonStyle(PlainButtonStyle())
        .scaleEffect(isPressed ? 0.95 : 1.0)
        .onLongPressGesture(minimumDuration: 0, maximumDistance: .infinity, pressing: { pressing in
            withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
                isPressed = pressing
            }
        }, perform: {})
    }
}

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = blendingMode
        view.state = .active
        return view
    }
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}

struct TimeSlot: Identifiable {
    let id = UUID()
    let title: String
    let createdAt: Date
    var lastUsed: Date
    
    var freshnessRatio: Double {
        let hoursSinceLastUsed = Date().timeIntervalSince(lastUsed) / 3600
        return max(0.0, min(1.0, 1.0 - (hoursSinceLastUsed / 72.0)))
    }
}

func formatRelativeTime(_ date: Date) -> String {
    let formatter = RelativeDateTimeFormatter()
    formatter.dateTimeStyle = .numeric
    formatter.unitsStyle = .abbreviated
    return formatter.localizedString(for: date, relativeTo: Date())
}