struct ContentView: View {
    @State private var items: [SlotItem] = [
        SlotItem(title: "Project Alpha", createdAt: Calendar.current.date(byAdding: .hour, value: -2, to: Date()) ?? Date(), accentColor: .blue),
        SlotItem(title: "Design Review", createdAt: Calendar.current.date(byAdding: .day, value: -1, to: Date()) ?? Date(), accentColor: .red),
        SlotItem(title: "Client Meeting", createdAt: Calendar.current.date(byAdding: .day, value: -3, to: Date()) ?? Date(), accentColor: .green),
        SlotItem(title: "Documentation", createdAt: Calendar.current.date(byAdding: .day, value: -6, to: Date()) ?? Date(), accentColor: .orange),
        SlotItem(title: "Code Review", createdAt: Calendar.current.date(byAdding: .day, value: -8, to: Date()) ?? Date(), accentColor: .purple)
    ]
    
    var body: some View {
        ZStack {
            Color(NSColor.windowBackgroundColor)
                .ignoresSafeArea()
            
            VStack(spacing: 24) {
                headerView
                
                itemGrid
                
                Spacer()
            }
            .padding(.top, 40)
            .padding(.horizontal, 40)
        }
        .frame(width: 1440, height: 900)
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
    
    var itemGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: 4), spacing: 16) {
            ForEach(items) { item in
                itemCardView(item)
            }
            
            ForEach(items.count..<8, id: \.self) { _ in
                emptySlotView
            }
        }
    }
    
    func itemCardView(_ item: SlotItem) -> some View {
        VStack(alignment: .leading, spacing: 12) {
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
        .frame(width: 280, height: 160)
        .background {
            RoundedRectangle(cornerRadius: 12)
                .fill(.regularMaterial)
                .stroke(Color(NSColor.separatorColor), lineWidth: 0.5)
        }
        .shadow(color: .black.opacity(0.05), radius: 2, x: 0, y: 1)
    }
    
    var emptySlotView: some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(.quinary)
            .stroke(Color(NSColor.separatorColor), lineWidth: 0.5)
            .frame(width: 280, height: 160)
            .overlay {
                Image(systemName: "plus")
                    .font(.system(.title2, weight: .medium))
                    .foregroundStyle(.tertiary)
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
                    .background(.blue, in: Capsule())
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