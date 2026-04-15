struct ContentView: View {
    @State private var items: [SlotItem] = [
        SlotItem(title: "Project Alpha", createdAt: Calendar.current.date(byAdding: .hour, value: -2, to: Date()) ?? Date(), accentColor: .accentColor),
        SlotItem(title: "Design Review", createdAt: Calendar.current.date(byAdding: .day, value: -1, to: Date()) ?? Date(), accentColor: .accentColor.opacity(0.8)),
        SlotItem(title: "Client Meeting", createdAt: Calendar.current.date(byAdding: .day, value: -3, to: Date()) ?? Date(), accentColor: .accentColor.opacity(0.6)),
        SlotItem(title: "Documentation", createdAt: Calendar.current.date(byAdding: .day, value: -6, to: Date()) ?? Date(), accentColor: .accentColor.opacity(0.4)),
        SlotItem(title: "Code Review", createdAt: Calendar.current.date(byAdding: .day, value: -8, to: Date()) ?? Date(), accentColor: .accentColor.opacity(0.3))
    ]
    
    @State private var hoveredCard: SlotItem? = nil
    @State private var hoveredEmptySlot = false
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color(NSColor.windowBackgroundColor)
                    .ignoresSafeArea()
                
                VStack(spacing: 24) {
                    headerView
                    
                    itemGrid(geometry: geometry)
                    
                    Spacer(minLength: 0)
                }
                .padding(.top, 40)
                .padding(.horizontal, max(40, (geometry.size.width - 1200) / 2))
            }
        }
        .frame(minWidth: 800, minHeight: 600)
    }
    
    var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Recent Items")
                    .font(.system(.largeTitle, design: .default, weight: .bold))
                    .foregroundStyle(.primary)
                
                Text("\(items.count) items")
                    .font(.system(.subheadline))
                    .foregroundStyle(.secondary)
            }
            
            Spacer()
            
            Button("Add Item") {
                // Action
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
    }
    
    func itemGrid(geometry: GeometryProxy) -> some View {
        let availableWidth = geometry.size.width - max(80, (geometry.size.width - 1200))
        let columns = max(2, min(4, Int(availableWidth / 300)))
        
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: columns), spacing: 16) {
            ForEach(items) { item in
                itemCardView(item)
            }
            
            ForEach(items.count..<8, id: \.self) { index in
                emptySlotView
            }
        }
    }
    
    func itemCardView(_ item: SlotItem) -> some View {
        let isHovered = hoveredCard?.id == item.id
        
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Circle()
                    .fill(item.accentColor)
                    .frame(width: 8, height: 8)
                
                Spacer()
                
                ageIndicator(item)
            }
            
            VStack(alignment: .leading, spacing: 8) {
                Text(item.title)
                    .font(.system(.headline, design: .default, weight: .semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                
                Text(RelativeDateTimeFormatter().localizedString(for: item.createdAt, relativeTo: Date()))
                    .font(.system(.caption, design: .default))
                    .foregroundStyle(.secondary)
            }
            
            Spacer()
        }
        .padding(16)
        .frame(minWidth: 240, maxWidth: .infinity, minHeight: 160, maxHeight: 160)
        .background {
            RoundedRectangle(cornerRadius: 12)
                .fill(isHovered ? .thickMaterial : .regularMaterial)
                .stroke(Color(NSColor.separatorColor), lineWidth: 0.5)
        }
        .scaleEffect(isHovered ? 1.02 : 1.0)
        .shadow(color: .black.opacity(isHovered ? 0.15 : 0.05), radius: isHovered ? 8 : 2, x: 0, y: isHovered ? 4 : 1)
        .animation(.easeOut(duration: 0.2), value: isHovered)
        .onHover { hovering in
            withAnimation(.easeOut(duration: 0.2)) {
                hoveredCard = hovering ? item : nil
            }
        }
    }
    
    var emptySlotView: some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(hoveredEmptySlot ? .quaternary : .quinary)
            .stroke(Color(NSColor.separatorColor), lineWidth: 0.5)
            .frame(minWidth: 240, maxWidth: .infinity, minHeight: 160, maxHeight: 160)
            .overlay {
                Image(systemName: "plus")
                    .font(.system(.title2, weight: .medium))
                    .foregroundStyle(hoveredEmptySlot ? .secondary : .tertiary)
            }
            .scaleEffect(hoveredEmptySlot ? 1.02 : 1.0)
            .animation(.easeOut(duration: 0.2), value: hoveredEmptySlot)
            .onHover { hovering in
                withAnimation(.easeOut(duration: 0.2)) {
                    hoveredEmptySlot = hovering
                }
            }
    }
    
    func ageIndicator(_ item: SlotItem) -> some View {
        Group {
            if item.ageInDays == 0 {
                Text("New")
                    .font(.system(.caption2, design: .default, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.accentColor, in: Capsule())
            } else if item.ageInDays <= 7 {
                Text("\(item.ageInDays)d")
                    .font(.system(.caption2, design: .default, weight: .medium))
                    .foregroundStyle(.secondary)
            } else {
                Text("\(item.ageInDays)d")
                    .font(.system(.caption2, design: .default, weight: .medium))
                    .foregroundStyle(.tertiary)
            }
        }
    }
}