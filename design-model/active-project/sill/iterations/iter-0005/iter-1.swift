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
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
            
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 12) {
                    ForEach(slots) { slot in
                        SlotCard(slot: slot)
                            .onTapGesture {
                                withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                                    updateSlotUsage(slot)
                                }
                            }
                    }
                    
                    if slots.count < 8 {
                        AddSlotButton {
                            withAnimation(.spring(response: 0.6, dampingFraction: 0.75)) {
                                addNewSlot()
                            }
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.vertical)
            }
        }
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
    @State private var isHovered = false
    @State private var isPressed = false
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .hudWindow, blendingMode: .withinWindow)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(slot.title)
                        .font(.system(.title3, design: .default, weight: .medium))
                        .foregroundStyle(.primary)
                    
                    Spacer()
                    
                    if slot.freshnessRatio > 0.7 {
                        Circle()
                            .fill(.green)
                            .frame(width: 8, height: 8)
                    }
                }
                
                HStack {
                    Text("Last used: \(formatRelativeTime(slot.lastUsed))")
                        .font(.system(.caption, design: .default, weight: .regular))
                        .foregroundStyle(.secondary)
                    
                    Spacer()
                    
                    Text("Created: \(formatRelativeTime(slot.createdAt))")
                        .font(.system(.caption, design: .default, weight: .regular))
                        .foregroundStyle(.tertiary)
                }
            }
            .padding()
        }
        .scaleEffect(isPressed ? 0.95 : (isHovered ? 1.02 : 1.0))
        .shadow(color: .black.opacity(0.1), radius: isHovered ? 8 : 4, x: 0, y: isHovered ? 4 : 2)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovered)
        .animation(.spring(response: 0.2, dampingFraction: 0.8), value: isPressed)
        .onHover { hovering in
            isHovered = hovering
        }
        .pressEvents {
            isPressed = true
        } onRelease: {
            isPressed = false
        }
    }
    
    private func formatRelativeTime(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

struct AddSlotButton: View {
    let action: () -> Void
    @State private var isHovered = false
    @State private var isPressed = false
    
    var body: some View {
        Button(action: action) {
            ZStack {
                VisualEffectView(material: .hudWindow, blendingMode: .withinWindow)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                
                VStack(spacing: 8) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(.title2, design: .default, weight: .medium))
                        .foregroundStyle(.accent)
                    
                    Text("Add New Slot")
                        .font(.system(.body, design: .default, weight: .medium))
                        .foregroundStyle(.primary)
                }
                .padding()
            }
        }
        .buttonStyle(PlainButtonStyle())
        .scaleEffect(isPressed ? 0.95 : (isHovered ? 1.02 : 1.0))
        .shadow(color: .black.opacity(0.1), radius: isHovered ? 8 : 4, x: 0, y: isHovered ? 4 : 2)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovered)
        .animation(.spring(response: 0.2, dampingFraction: 0.8), value: isPressed)
        .onHover { hovering in
            isHovered = hovering
        }
        .pressEvents {
            isPressed = true
        } onRelease: {
            isPressed = false
        }
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
        self.simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in onPress() }
                .onEnded { _ in onRelease() }
        )
    }
}