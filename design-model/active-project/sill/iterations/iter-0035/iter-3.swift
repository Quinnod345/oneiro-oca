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
            Color(NSColor.windowBackgroundColor)
            
            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Windowsill")
                            .font(.system(.largeTitle, design: .default, weight: .light))
                            .foregroundColor(.primary)
                        
                        Text("Things gather dust here")
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
                                .fill(Color(NSColor.quaternaryLabelColor))
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
                            .fill(.primary)
                            .frame(width: 6, height: 6)
                        
                        Text("Recent")
                            .font(.system(.caption2, design: .default, weight: .medium))
                            .foregroundColor(.secondary)
                    }
                    
                    HStack(spacing: 6) {
                        Circle()
                            .fill(.secondary)
                            .frame(width: 6, height: 6)
                        
                        Text("Dusty")
                            .font(.system(.caption2, design: .default, weight: .medium))
                            .foregroundColor(.secondary)
                    }
                    
                    HStack(spacing: 6) {
                        Circle()
                            .fill(.tertiary)
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
    
    var dustOpacity: Double {
        let daysSince = Date().timeIntervalSince(item.createdAt) / 86400
        
        if daysSince < 2 {
            return 0.95
        } else if daysSince < 5 {
            return 0.7
        } else {
            return 0.4
        }
    }
    
    var dustColor: Color {
        let daysSince = Date().timeIntervalSince(item.createdAt) / 86400
        
        if daysSince < 2 {
            return .primary
        } else if daysSince < 5 {
            return .secondary
        } else {
            return .tertiary
        }
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Circle()
                    .fill(dustColor)
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
        .opacity(dustOpacity)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(NSColor.controlBackgroundColor))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color(NSColor.separatorColor), lineWidth: 0.5)
                )
                .brightness(isHovered ? 0.05 : 0)
        )
        .animation(.easeInOut(duration: 0.15), value: isHovered)
        .onHover { hovering in
            isHovered = hovering
        }
    }
    
    private func timeAgoString(from date: Date) -> String {
        let interval = Date().timeIntervalSince(date)
        let days = Int(interval / 86400)
        
        if days == 0 {
            return "today"
        } else if days == 1 {
            return "yesterday"
        } else {
            return "\(days) days ago"
        }
    }
}