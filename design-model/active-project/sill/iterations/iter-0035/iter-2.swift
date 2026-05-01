struct ContentView: View {
    @State private var items: [WindowsillItem] = [
        WindowsillItem(title: "Morning Notes", createdAt: Date().addingTimeInterval(-86400 * 1)),
        WindowsillItem(title: "Project Ideas", createdAt: Date().addingTimeInterval(-86400 * 4)),
        WindowsillItem(title: "Reading List", createdAt: Date().addingTimeInterval(-86400 * 7)),
        WindowsillItem(title: "Quick Thoughts", createdAt: Date().addingTimeInterval(-86400 * 0.5)),
        WindowsillItem(title: "Meeting Notes", createdAt: Date().addingTimeInterval(-86400 * 6))
    ]
    
    private let columns = [
        GridItem(.adaptive(minimum: 240), spacing: 16)
    ]
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
            
            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Windowsill")
                            .font(.system(.largeTitle, design: .default, weight: .light))
                            .foregroundColor(.primary)
                        
                        Text("Things settle here")
                            .font(.system(.caption, design: .default, weight: .regular))
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                    
                    Text("\(items.count)/8")
                        .font(.system(.caption, design: .default, weight: .medium))
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(
                            Capsule()
                                .fill(.quaternary)
                        )
                }
                .padding(.horizontal, 20)
                .padding(.top, 30)
                
                Spacer()
                
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(items) { item in
                        WindowsillItemView(item: item)
                    }
                }
                .padding(.horizontal, 20)
                
                Spacer()
                
                HStack(spacing: 20) {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(.mint)
                            .frame(width: 6, height: 6)
                        
                        Text("Fresh")
                            .font(.system(.caption2, design: .default, weight: .medium))
                            .foregroundColor(.secondary)
                    }
                    
                    HStack(spacing: 6) {
                        Circle()
                            .fill(.orange)
                            .frame(width: 6, height: 6)
                        
                        Text("Settling")
                            .font(.system(.caption2, design: .default, weight: .medium))
                            .foregroundColor(.secondary)
                    }
                    
                    HStack(spacing: 6) {
                        Circle()
                            .fill(.secondary)
                            .frame(width: 6, height: 6)
                        
                        Text("Weathered")
                            .font(.system(.caption2, design: .default, weight: .medium))
                            .foregroundColor(.secondary)
                    }
                }
                .padding(.bottom, 24)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct WindowsillItemView: View {
    let item: WindowsillItem
    @State private var isHovered = false
    
    var ageColor: Color {
        let daysSince = Date().timeIntervalSince(item.createdAt) / 86400
        
        if daysSince < 2 {
            return .mint
        } else if daysSince < 5 {
            return .orange
        } else {
            return .secondary
        }
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Circle()
                    .fill(ageColor)
                    .frame(width: 8, height: 8)
                
                Spacer()
                
                Text(timeAgoString(from: item.createdAt))
                    .font(.system(.caption2, design: .default, weight: .medium))
                    .foregroundColor(.secondary)
            }
            
            Text(item.title)
                .font(.system(.body, design: .default, weight: .medium))
                .foregroundColor(.primary)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .frame(minHeight: 80)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(.regularMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(.quaternary, lineWidth: 0.5)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(
                            LinearGradient(
                                gradient: Gradient(colors: [ageColor.opacity(0.15), ageColor.opacity(0.05)]),
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                )
        )
        .scaleEffect(isHovered ? 1.02 : 1.0)
        .shadow(color: .black.opacity(isHovered ? 0.1 : 0.05), radius: isHovered ? 8 : 4, x: 0, y: isHovered ? 4 : 2)
        .animation(.easeInOut(duration: 0.2), value: isHovered)
        .onHover { hovering in
            isHovered = hovering
        }
        .onTapGesture {
        }
    }
    
    private func timeAgoString(from date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let visualEffectView = NSVisualEffectView()
        visualEffectView.material = material
        visualEffectView.blendingMode = blendingMode
        visualEffectView.state = .active
        return visualEffectView
    }
    
    func updateNSView(_ visualEffectView: NSVisualEffectView, context: Context) {
        visualEffectView.material = material
        visualEffectView.blendingMode = blendingMode
    }
}