struct TimeDecayItem: Identifiable {
    let id = UUID()
    let content: String
    let createdAt: Date
    
    var ageInDays: Double {
        Date().timeIntervalSince(createdAt) / 86400
    }
    
    var opacity: Double {
        switch ageInDays {
        case 0..<3: return 1.0
        case 3..<7: return 0.7
        case 7..<14: return 0.5
        default: return 0.3
        }
    }
    
    var borderColor: Color {
        switch ageInDays {
        case 0..<1: return Color.orange
        case 1..<3: return Color.yellow
        case 3..<7: return Color.gray
        default: return Color(red: 0.4, green: 0.35, blue: 0.3)
        }
    }
    
    var shouldPulse: Bool {
        ageInDays <= 3
    }
}

struct LinenTexture: View {
    var body: some View {
        GeometryReader { geometry in
            Path { path in
                let spacing: CGFloat = 2
                let width = geometry.size.width
                let height = geometry.size.height
                
                for x in stride(from: 0, through: width, by: spacing) {
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x, y: height))
                }
                
                for y in stride(from: 0, through: height, by: spacing) {
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: width, y: y))
                }
            }
            .stroke(Color.white.opacity(0.1), lineWidth: 0.5)
        }
    }
}

struct ContentView: View {
    @State private var items: [TimeDecayItem] = []
    @State private var pulsePhase: Double = 0.0
    @State private var clearingItems: Set<UUID> = []
    
    var body: some View {
        ZStack {
            Color(red: 0.2, green: 0.15, blue: 0.1)
                .ignoresSafeArea()
            
            VStack(spacing: 0) {
                HStack {
                    Text("Memory Shelf")
                        .font(.system(size: 18, weight: .medium, design: .serif))
                        .foregroundColor(Color(red: 0.9, green: 0.8, blue: 0.6))
                    
                    Spacer()
                    
                    Text("\(items.count)/8")
                        .font(.system(size: 12, weight: .light, design: .monospaced))
                        .foregroundColor(Color(red: 0.7, green: 0.6, blue: 0.4))
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color(red: 0.25, green: 0.2, blue: 0.15))
                        .overlay(
                            LinenTexture()
                                .opacity(0.08)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                        )
                    
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4), spacing: 12) {
                        ForEach(items) { item in
                            itemView(for: item)
                        }
                        
                        ForEach(0..<(8 - items.count), id: \.self) { _ in
                            emptySlot
                        }
                    }
                    .padding(16)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            startPulseAnimation()
            setupSampleData()
        }
        .gesture(
            DragGesture(minimumDistance: 100)
                .onEnded { gesture in
                    if gesture.translation.width < -200 && gesture.translation.height > -50 && gesture.translation.height < 50 {
                        clearAgedItems()
                    }
                }
        )
    }
    
    private func itemView(for item: TimeDecayItem) -> some View {
        let borderGlow = item.shouldPulse ? (sin(pulsePhase) * 0.3 + 0.7) : 1.0
        
        return RoundedRectangle(cornerRadius: 8)
            .fill(Color(red: 0.15, green: 0.12, blue: 0.08))
            .overlay(
                VStack(spacing: 4) {
                    Text(item.content)
                        .font(.system(size: 11, weight: .regular, design: .default))
                        .foregroundColor(Color.white)
                        .lineLimit(3)
                        .multilineTextAlignment(.center)
                    
                    Text(formatAge(item.ageInDays))
                        .font(.system(size: 8, weight: .light, design: .monospaced))
                        .foregroundColor(Color(red: 0.6, green: 0.5, blue: 0.4))
                }
                .padding(6)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(item.borderColor.opacity(borderGlow), lineWidth: item.ageInDays <= 3 ? 2 : 1)
            )
            .opacity(clearingItems.contains(item.id) ? 0 : item.opacity)
            .scaleEffect(clearingItems.contains(item.id) ? 0.1 : 1.0)
            .rotationEffect(clearingItems.contains(item.id) ? .degrees(Double.random(in: -180...180)) : .degrees(0))
            .animation(.spring(response: 0.6, dampingFraction: 0.8), value: clearingItems.contains(item.id))
            .frame(height: 80)
    }
    
    private var emptySlot: some View {
        RoundedRectangle(cornerRadius: 8)
            .stroke(Color(red: 0.3, green: 0.25, blue: 0.2), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
            .frame(height: 80)
    }
    
    private func formatAge(_ days: Double) -> String {
        if days < 1 {
            let hours = Int(days * 24)
            return "\(hours)h"
        } else {
            return "\(Int(days))d"
        }
    }
    
    private func startPulseAnimation() -> Void {
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            pulsePhase += 0.1
        }
    }
    
    private func clearAgedItems() -> Void {
        let agedItems = items.filter { $0.ageInDays > 7 }
        
        for item in agedItems {
            clearingItems.insert(item.id)
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            items.removeAll { clearingItems.contains($0.id) }
            clearingItems.removeAll()
        }
    }
    
    private func setupSampleData() -> Void {
        let sampleItems = [
            TimeDecayItem(content: "Design Review\nMeeting Notes", createdAt: Date().addingTimeInterval(-2 * 86400)),
            TimeDecayItem(content: "Coffee Shop\nWiFi Password", createdAt: Date().addingTimeInterval(-5 * 86400)),
            TimeDecayItem(content: "Invoice #2847\nDue Next Week", createdAt: Date().addingTimeInterval(-8 * 86400)),
            TimeDecayItem(content: "Swift 6.2\nNew Features", createdAt: Date().addingTimeInterval(-1 * 86400)),
            TimeDecayItem(content: "Weekend Plans\nHiking Trail Map", createdAt: Date().addingTimeInterval(-10 * 86400))
        ]
        
        items = Array(sampleItems.prefix(5))
    }
}