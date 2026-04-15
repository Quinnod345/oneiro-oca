struct ContentView: View {
    @State private var items: [SlotItem] = [
        SlotItem(title: "Project Alpha", createdAt: Calendar.current.date(byAdding: .hour, value: -2, to: Date()) ?? Date(), accentColor: .blue),
        SlotItem(title: "Design Review", createdAt: Calendar.current.date(byAdding: .day, value: -1, to: Date()) ?? Date(), accentColor: .purple),
        SlotItem(title: "Client Meeting", createdAt: Calendar.current.date(byAdding: .day, value: -3, to: Date()) ?? Date(), accentColor: .orange),
        SlotItem(title: "Documentation", createdAt: Calendar.current.date(byAdding: .day, value: -6, to: Date()) ?? Date(), accentColor: .green),
        SlotItem(title: "Code Review", createdAt: Calendar.current.date(byAdding: .day, value: -8, to: Date()) ?? Date(), accentColor: .red)
    ]
    
    @State private var hoveredCard: SlotItem? = nil
    @State private var hoveredEmptySlot = false
    @State private var emptySlotTimer: Timer?
    @State private var showEmptySlotPulse = false
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                LinearGradient(
                    colors: [
                        Color(NSColor.windowBackgroundColor),
                        Color(NSColor.windowBackgroundColor).opacity(0.95)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()
                
                VStack(spacing: 32) {
                    headerView
                    
                    itemGrid(geometry: geometry)
                    
                    Spacer(minLength: 0)
                }
                .padding(.top, 40)
                .padding(.horizontal, max(40, (geometry.size.width - 1200) / 2))
            }
        }
        .frame(minWidth: 800, minHeight: 600)
        .onAppear {
            startEmptySlotAnimation()
        }
    }
    
    var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                Text("Recent Items")
                    .font(.system(.largeTitle, design: .rounded, weight: .bold))
                    .foregroundStyle(.primary)
                
                Text("\(items.count) active items")
                    .font(.system(.subheadline, design: .rounded, weight: .medium))
                    .foregroundStyle(.secondary)
            }
            
            Spacer()
            
            Button(action: {}) {
                HStack(spacing: 8) {
                    Image(systemName: "plus.circle.fill")
                    Text("Add Item")
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
    }
    
    func itemGrid(geometry: GeometryProxy) -> some View {
        let availableWidth = geometry.size.width - max(80, (geometry.size.width - 1200))
        let columns = max(2, min(4, Int(availableWidth / 300)))
        
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 20), count: columns), spacing: 20) {
            if !items.isEmpty {
                heroCardView(items[0])
            }
            
            ForEach(items.dropFirst()) { item in
                itemCardView(item)
            }
            
            ForEach(items.count..<8, id: \.self) { index in
                emptySlotView
            }
        }
    }
    
    func heroCardView(_ item: SlotItem) -> some View {
        let isHovered = hoveredCard?.id == item.id
        
        return VStack(alignment: .leading, spacing: 16) {
            HStack {
                HStack(spacing: 8) {
                    Circle()
                        .fill(item.accentColor)
                        .frame(width: 12, height: 12)
                    
                    Text("PRIORITY")
                        .font(.system(.caption2, design: .rounded, weight: .bold))
                        .foregroundStyle(item.accentColor)
                }
                
                Spacer()
                
                ageIndicator(item)
            }
            
            VStack(alignment: .leading, spacing: 12) {
                Text(item.title)
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .foregroundStyle(.primary)
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)
                
                Text(RelativeDateTimeFormatter().localizedString(for: item.createdAt, relativeTo: Date()))
                    .font(.system(.callout, design: .rounded, weight: .medium))
                    .foregroundStyle(.secondary)
            }
            
            Spacer()
            
            HStack {
                Spacer()
                Image(systemName: "arrow.up.right.circle.fill")
                    .font(.title2)
                    .foregroundStyle(item.accentColor)
            }
        }
        .padding(24)
        .frame(minWidth: 240, maxWidth: .infinity, minHeight: 200, maxHeight: 200)
        .background {
            RoundedRectangle(cornerRadius: 16)
                .fill(isHovered ? .thickMaterial : .regularMaterial)
                .stroke(item.accentColor.opacity(0.3), lineWidth: isHovered ? 2 : 1)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(item.accentColor.opacity(0.05))
                )
        }
        .scaleEffect(isHovered ? 1.03 : 1.0)
        .shadow(color: item.accentColor.opacity(isHovered ? 0.3 : 0.1), radius: isHovered ? 12 : 4, x: 0, y: isHovered ? 6 : 2)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovered)
        .onHover { hovering in
            withAnimation {
                hoveredCard = hovering ? item : nil
            }
        }
    }
    
    func itemCardView(_ item: SlotItem) -> some View {
        let isHovered = hoveredCard?.id == item.id
        
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Circle()
                    .fill(item.accentColor)
                    .frame(width: 10, height: 10)
                
                Spacer()
                
                ageIndicator(item)
            }
            
            VStack(alignment: .leading, spacing: 8) {
                Text(item.title)
                    .font(.system(.headline, design: .rounded, weight: .semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                
                Text(RelativeDateTimeFormatter().localizedString(for: item.createdAt, relativeTo: Date()))
                    .font(.system(.caption, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            
            Spacer()
        }
        .padding(18)
        .frame(minWidth: 240, maxWidth: .infinity, minHeight: 140, maxHeight: 140)
        .background {
            RoundedRectangle(cornerRadius: 14)
                .fill(isHovered ? .thickMaterial : .regularMaterial)
                .stroke(item.accentColor.opacity(isHovered ? 0.4 : 0.2), lineWidth: 1)
        }
        .scaleEffect(isHovered ? 1.02 : 1.0)
        .shadow(color: item.accentColor.opacity(isHovered ? 0.2 : 0.08), radius: isHovered ? 8 : 3, x: 0, y: isHovered ? 4 : 2)
        .animation(.easeOut(duration: 0.2), value: isHovered)
        .onHover { hovering in
            withAnimation(.easeOut(duration: 0.2)) {
                hoveredCard = hovering ? item : nil
            }
        }
    }
    
    var emptySlotView: some View {
        VStack(spacing: 12) {
            Image(systemName: "plus.circle.dashed")
                .font(.system(.largeTitle, weight: .light))
                .foregroundStyle(hoveredEmptySlot ? .accentColor : .tertiary)
                .scaleEffect(showEmptySlotPulse ? 1.1 : 1.0)
                .animation(.easeInOut(duration: 2.0).repeatForever(autoreverses: true), value: showEmptySlotPulse)
            
            Text("Add new item")
                .font(.system(.caption, design: .rounded, weight: .medium))
                .foregroundStyle(hoveredEmptySlot ? .secondary : .quaternary)
        }
        .frame(minWidth: 240, maxWidth: .infinity, minHeight: 140, maxHeight: 140)
        .background {
            RoundedRectangle(cornerRadius: 14)
                .stroke(
                    hoveredEmptySlot ? .accentColor.opacity(0.5) : .quaternary,
                    style: StrokeStyle(lineWidth: 2, dash: [8, 6])
                )
                .fill(hoveredEmptySlot ? .accentColor.opacity(0.05) : .clear)
        }
        .scaleEffect(hoveredEmptySlot ? 1.02 : 1.0)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: hoveredEmptySlot)
        .onHover { hovering in
            withAnimation {
                hoveredEmptySlot = hovering
            }
        }
    }
    
    func ageIndicator(_ item: SlotItem) -> some View {
        Group {
            if item.ageInDays == 0 {
                Text("New")
                    .font(.system(.caption2, design: .rounded, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(.accentColor, in: Capsule())
            } else if item.ageInDays <= 7 {
                Text("\(item.ageInDays)d")
                    .font(.system(.caption2, design: .rounded, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.quaternary, in: Capsule())
            }
        }
    }
    
    func startEmptySlotAnimation() {
        emptySlotTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { _ in
            withAnimation {
                showEmptySlotPulse.toggle()
            }
        }
        showEmptySlotPulse = true
    }
}