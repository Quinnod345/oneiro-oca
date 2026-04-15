struct ContentView: View {
    @State private var slots: [TimeSlot] = [
        TimeSlot(title: "Morning Pages", createdAt: Date().addingTimeInterval(-86400 * 3), lastUsed: Date().addingTimeInterval(-3600 * 2)),
        TimeSlot(title: "Design Review", createdAt: Date().addingTimeInterval(-86400 * 1), lastUsed: Date().addingTimeInterval(-3600 * 8)),
        TimeSlot(title: "Weekly Planning", createdAt: Date().addingTimeInterval(-86400 * 7), lastUsed: Date().addingTimeInterval(-3600 * 72)),
        TimeSlot(title: "Code Review", createdAt: Date().addingTimeInterval(-86400 * 2), lastUsed: Date().addingTimeInterval(-3600 * 1)),
        TimeSlot(title: "Client Call", createdAt: Date().addingTimeInterval(-86400 * 5), lastUsed: Date().addingTimeInterval(-3600 * 120))
    ]
    
    @State private var selectedSlot: TimeSlot?
    
    var sortedSlots: [TimeSlot] {
        slots.sorted { $0.lastUsed > $1.lastUsed }
    }
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
            
            VStack(spacing: 0) {
                HeaderView(totalSlots: slots.count)
                
                TimelineView(slots: sortedSlots) { slot in
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
    }
    
    private func updateSlotUsage(_ slot: TimeSlot) {
        if let index = slots.firstIndex(where: { $0.id == slot.id }) {
            slots[index].lastUsed = Date()
        }
    }
    
    private func deleteSlot(_ slot: TimeSlot) {
        withAnimation(.easeOut(duration: 0.2)) {
            slots.removeAll { $0.id == slot.id }
        }
    }
    
    private func addNewSlot() {
        let newSlot = TimeSlot(
            title: "New Activity",
            createdAt: Date(),
            lastUsed: Date()
        )
        withAnimation(.easeOut(duration: 0.2)) {
            slots.append(newSlot)
        }
    }
}

struct HeaderView: View {
    let totalSlots: Int
    
    var body: some View {
        VStack(spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Activity Timeline")
                        .font(.system(.title2, design: .default, weight: .semibold))
                        .foregroundStyle(.primary)
                    
                    Text("\(totalSlots) tracked activities")
                        .font(.system(.caption, design: .default, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                
                Spacer()
                
                ActivityHeatMap()
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            
            Divider()
                .opacity(0.3)
        }
    }
}

struct ActivityHeatMap: View {
    private let days = Array(0..<7).map { Calendar.current.date(byAdding: .day, value: -$0, to: Date())! }
    
    var body: some View {
        HStack(spacing: 2) {
            ForEach(days.reversed(), id: \.self) { day in
                RoundedRectangle(cornerRadius: 2)
                    .fill(intensityColor(for: day))
                    .frame(width: 8, height: 8)
            }
        }
    }
    
    private func intensityColor(for date: Date) -> Color {
        let intensity = Double.random(in: 0...1)
        return Color.accentColor.opacity(0.2 + intensity * 0.6)
    }
}

struct TimelineView: View {
    let slots: [TimeSlot]
    let onTap: (TimeSlot) -> Void
    let onDelete: (TimeSlot) -> Void
    
    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(spacing: 1) {
                ForEach(Array(slots.enumerated()), id: \.element.id) { index, slot in
                    TimelineRowView(
                        slot: slot,
                        isFirst: index == 0,
                        isLast: index == slots.count - 1
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
    let onTap: () -> Void
    let onDelete: () -> Void
    
    @State private var isPressed = false
    
    var freshnessOpacity: Double {
        max(0.3, slot.freshnessRatio)
    }
    
    var body: some View {
        HStack(spacing: 12) {
            TimelineIndicator(
                freshness: slot.freshnessRatio,
                isFirst: isFirst,
                isLast: isLast
            )
            
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(slot.title)
                        .font(.system(.body, design: .default, weight: .medium))
                        .foregroundStyle(.primary.opacity(freshnessOpacity))
                    
                    Spacer()
                    
                    Text(formatRelativeTime(slot.lastUsed))
                        .font(.system(.caption, design: .monospaced, weight: .regular))
                        .foregroundStyle(.secondary.opacity(freshnessOpacity))
                }
                
                UsageBar(freshness: slot.freshnessRatio)
            }
            .padding(.vertical, 12)
            .contentShape(Rectangle())
            .scaleEffect(isPressed ? 0.98 : 1.0)
            .animation(.easeOut(duration: 0.1), value: isPressed)
            .onTapGesture {
                onTap()
            }
            .pressEvents {
                isPressed = true
            } onRelease: {
                isPressed = false
            }
            .swipeActions(edge: .trailing) {
                Button("Delete", systemImage: "trash") {
                    onDelete()
                }
                .tint(.red)
            }
        }
        .background(
            Rectangle()
                .fill(.quaternary.opacity(0.3))
                .opacity(isPressed ? 1 : 0)
        )
    }
    
    private func formatRelativeTime(_ date: Date) -> String {
        let interval = Date().timeIntervalSince(date)
        let hours = Int(interval / 3600)
        
        if hours < 1 {
            return "now"
        } else if hours < 24 {
            return "\(hours)h"
        } else {
            return "\(hours / 24)d"
        }
    }
}

struct TimelineIndicator: View {
    let freshness: Double
    let isFirst: Bool
    let isLast: Bool
    
    var body: some View {
        VStack(spacing: 0) {
            if !isFirst {
                Rectangle()
                    .fill(.quaternary)
                    .frame(width: 1, height: 16)
            }
            
            Circle()
                .fill(Color.accentColor.opacity(0.3 + freshness * 0.7))
                .frame(width: 6, height: 6)
                .overlay(
                    Circle()
                        .fill(Color.accentColor)
                        .frame(width: 2, height: 2)
                        .opacity(freshness > 0.7 ? 1 : 0)
                )
            
            if !isLast {
                Rectangle()
                    .fill(.quaternary)
                    .frame(width: 1, height: 16)
            }
        }
    }
}

struct UsageBar: View {
    let freshness: Double
    
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Rectangle()
                    .fill(.quaternary.opacity(0.5))
                    .frame(height: 2)
                
                Rectangle()
                    .fill(Color.accentColor.opacity(0.4 + freshness * 0.6))
                    .frame(width: geometry.size.width * freshness, height: 2)
            }
        }
        .frame(height: 2)
    }
}

struct CompactAddButton: View {
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: "plus")
                    .font(.system(.caption, design: .default, weight: .medium))
                    .foregroundStyle(.secondary)
                
                Text("Add Activity")
                    .font(.system(.caption, design: .default, weight: .medium))
                    .foregroundStyle(.secondary)
                
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(.quaternary.opacity(0.5))
                    .stroke(.quaternary, lineWidth: 1)
            )
        }
        .buttonStyle(PlainButtonStyle())
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

extension View {
    func pressEvents(onPress: @escaping () -> Void, onRelease: @escaping () -> Void) -> some View {
        self.onLongPressGesture(minimumDuration: 0, maximumDistance: .infinity) {
        } onPressingChanged: { pressing in
            if pressing {
                onPress()
            } else {
                onRelease()
            }
        }
    }
}

extension View {
    func swipeActions<T>(edge: HorizontalEdge, @ViewBuilder content: () -> T) -> some View where T: View {
        self
    }
}

struct TimeSlot: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let createdAt: Date
    var lastUsed: Date
    
    var freshnessRatio: Double {
        let timeSinceLastUse = Date().timeIntervalSince(lastUsed)
        let daysSince = timeSinceLastUse / 86400
        return max(0, 1 - (daysSince / 7))
    }
}