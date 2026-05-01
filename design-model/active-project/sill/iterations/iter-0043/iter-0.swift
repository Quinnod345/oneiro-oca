struct ClipboardItem: Identifiable {
    let id = UUID()
    let content: String
    let createdAt: Date
    var opacity: Double = 1.0
    var sepiaIntensity: Double = 0.0
    var patina: Double = 0.0
}

extension Color {
    var components: (red: Double, green: Double, blue: Double) {
        let uiColor = NSColor(self)
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        uiColor.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        return (Double(red), Double(green), Double(blue))
    }
}

struct ContentView: View {
    @State private var items: [ClipboardItem] = []
    @State private var breathTimers: [UUID: Timer] = [:]
    @State private var breathingItems: Set<UUID> = []
    @State private var hourlyTimer: Timer?
    
    let maxItems: Int = 8
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Warm ambient base
                LinearGradient(
                    colors: [
                        Color(red: 0.95, green: 0.94, blue: 0.92),
                        Color(red: 0.92, green: 0.89, blue: 0.85)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()
                
                // Subtle dust particles
                ForEach(0..<8, id: \.self) { index in
                    Circle()
                        .fill(Color(red: 0.85, green: 0.82, blue: 0.78))
                        .frame(width: 2, height: 2)
                        .opacity(0.3)
                        .position(
                            x: geometry.size.width * Double.random(in: 0.1...0.9),
                            y: geometry.size.height * Double.random(in: 0.1...0.9)
                        )
                }
                
                // Main shelf
                VStack(spacing: 0) {
                    // Shelf header
                    HStack {
                        Text("Shelf")
                            .font(.system(size: 24, weight: .medium, design: .serif))
                            .foregroundColor(Color(red: 0.35, green: 0.28, blue: 0.22))
                        
                        Spacer()
                        
                        Text("\(items.count)/\(maxItems)")
                            .font(.system(size: 14, weight: .regular, design: .monospaced))
                            .foregroundColor(Color(red: 0.55, green: 0.48, blue: 0.42))
                    }
                    .padding(.horizontal, 32)
                    .padding(.top, 24)
                    
                    // Items grid
                    ScrollView {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: 2), spacing: 16) {
                            ForEach(items) { item in
                                itemView(for: item, in: geometry)
                            }
                        }
                        .padding(.horizontal, 32)
                        .padding(.top, 20)
                    }
                    
                    Spacer()
                }
            }
        }
        .frame(width: 1440, height: 900)
        .onAppear {
            setupMockData()
            startHourlyBreathing()
        }
        .onDisappear {
            stopAllTimers()
        }
    }
    
    private func itemView(for item: ClipboardItem, in geometry: GeometryProxy) -> some View {
        let baseColor = Color(red: 0.98, green: 0.97, blue: 0.95)
        let agedColor = Color(red: 0.94, green: 0.87, blue: 0.72)
        let blendedColor = Color(
            red: baseColor.components.red * (1 - item.sepiaIntensity) + agedColor.components.red * item.sepiaIntensity,
            green: baseColor.components.green * (1 - item.sepiaIntensity) + agedColor.components.green * item.sepiaIntensity,
            blue: baseColor.components.blue * (1 - item.sepiaIntensity) + agedColor.components.blue * item.sepiaIntensity
        )
        
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Circle()
                    .fill(Color(red: 0.85, green: 0.76, blue: 0.65))
                    .frame(width: 8, height: 8)
                    .opacity(item.opacity)
                
                Spacer()
                
                Text(timeAgoString(from: item.createdAt))
                    .font(.system(size: 11, weight: .regular, design: .monospaced))
                    .foregroundColor(Color(red: 0.65, green: 0.58, blue: 0.52))
                    .opacity(item.opacity * 0.8)
            }
            
            Text(item.content)
                .font(.system(size: 15, weight: .regular, design: .default))
                .foregroundColor(Color(red: 0.25, green: 0.20, blue: 0.15))
                .lineLimit(4)
                .opacity(item.opacity)
                .multilineTextAlignment(.leading)
            
            Spacer()
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(blendedColor)
                .opacity(item.opacity)
                .shadow(
                    color: Color(red: 0.75, green: 0.68, blue: 0.58).opacity(0.2 * item.opacity),
                    radius: 2 + (item.patina * 4),
                    x: 0,
                    y: 1 + (item.patina * 2)
                )
        )
        .scaleEffect(breathingItems.contains(item.id) ? 1.0 : 0.97)
        .animation(.easeInOut(duration: 0.8), value: breathingItems.contains(item.id))
        .frame(height: 120)
    }
    
    private func setupMockData() {
        let sampleItems = [
            "Design a minimalist todo app interface",
            "Remember to buy fresh herbs for tonight's dinner",
            "https://github.com/user/interesting-repo",
            "The quick brown fox jumps over the lazy dog",
            "Meeting notes: discuss Q4 roadmap priorities",
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit",
            "Check weather forecast for weekend hiking trip",
            "Swift 6.2 async/await best practices"
        ]
        
        items = sampleItems.enumerated().map { index, content in
            ClipboardItem(
                content: content,
                createdAt: Date().addingTimeInterval(-Double(index) * 24 * 60 * 60)
            )
        }
    }
    
    private func startHourlyBreathing() {
        hourlyTimer = Timer.scheduledTimer(withTimeInterval: 3600, repeats: true) { _ in
            breatheRandomItem()
        }
    }
    
    private func breatheRandomItem() {
        guard !items.isEmpty else { return }
        let randomItem = items.randomElement()!
        
        withAnimation {
            breathingItems.insert(randomItem.id)
        }
        
        breathTimers[randomItem.id] = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: false) { _ in
            withAnimation {
                breathingItems.remove(randomItem.id)
            }
            breathTimers.removeValue(forKey: randomItem.id)
        }
    }
    
    private func stopAllTimers() {
        hourlyTimer?.invalidate()
        hourlyTimer = nil
        
        for (_, timer) in breathTimers {
            timer.invalidate()
        }
        breathTimers.removeAll()
    }
    
    private func timeAgoString(from date: Date) -> String {
        let interval = Date().timeIntervalSince(date)
        let days = Int(interval / 86400)
        
        if days == 0 {
            return "today"
        } else if days == 1 {
            return "1 day ago"
        } else {
            return "\(days) days ago"
        }
    }
}