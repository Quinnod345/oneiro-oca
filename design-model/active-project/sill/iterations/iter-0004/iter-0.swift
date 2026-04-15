struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(title: "Design System.sketch", addedAt: Date().addingTimeInterval(-3600), contentType: .file, preview: "📐"),
        ShelfItem(title: "Meeting Notes", addedAt: Date().addingTimeInterval(-86400), contentType: .text, preview: "Key decisions from..."),
        ShelfItem(title: "Sunset.jpg", addedAt: Date().addingTimeInterval(-172800), contentType: .image, preview: "🌅"),
        ShelfItem(title: "API Documentation", addedAt: Date().addingTimeInterval(-259200), contentType: .text, preview: "REST endpoints..."),
        ShelfItem(title: "Prototype.fig", addedAt: Date().addingTimeInterval(-432000), contentType: .file, preview: "🎨"),
        ShelfItem(title: "Old Script", addedAt: Date().addingTimeInterval(-518400), contentType: .file, preview: "#!/bin/bash")
    ]
    
    var body: some View {
        ZStack {
            Color(red: 0.4, green: 0.25, blue: 0.15)
                .ignoresSafeArea()
            
            HStack(spacing: 16) {
                ForEach(items.prefix(8)) { item in
                    ShelfSlotView(item: item)
                }
                
                ForEach(0..<max(0, 8 - items.count), id: \.self) { _ in
                    EmptySlotView()
                }
            }
            .padding(20)
        }
        .frame(width: 1440, height: 900)
    }
}

struct ShelfSlotView: View {
    let item: ShelfItem
    
    private var ageInDays: Double {
        Date().timeIntervalSince(item.addedAt) / 86400
    }
    
    private var glowColor: Color {
        if ageInDays < 1 {
            return Color(red: 1.0, green: 0.7, blue: 0.3)
        } else if ageInDays < 3 {
            return Color(red: 1.0, green: 0.95, blue: 0.85)
        } else {
            return Color(red: 0.7, green: 0.8, blue: 0.9)
        }
    }
    
    private var opacity: Double {
        if ageInDays >= 3 {
            return 0.6
        }
        return 1.0
    }
    
    private var shouldPulse: Bool {
        ageInDays < 1
    }
    
    private var showFrost: Bool {
        ageInDays >= 6
    }
    
    @State private var pulseOpacity: Double = 1.0
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(red: 0.15, green: 0.12, blue: 0.1))
                .frame(width: 140, height: 180)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(glowColor.opacity(shouldPulse ? pulseOpacity : 1.0), lineWidth: 2)
                        .blur(radius: 6)
                )
                .shadow(color: glowColor.opacity(0.4), radius: 8, x: 0, y: 0)
            
            VStack(spacing: 8) {
                Group {
                    if item.contentType == .text {
                        Text(item.preview)
                            .font(.system(size: 11, weight: .regular, design: .default))
                            .foregroundColor(Color.white.opacity(0.8))
                            .lineLimit(4)
                            .multilineTextAlignment(.leading)
                    } else {
                        Text(item.preview)
                            .font(.system(size: 32, weight: .regular, design: .default))
                    }
                }
                .frame(height: 80)
                
                Text(item.title)
                    .font(.system(size: 12, weight: .medium, design: .default))
                    .foregroundColor(Color.white)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
            .padding(12)
            .opacity(opacity)
            
            if showFrost {
                RoundedRectangle(cornerRadius: 12)
                    .fill(
                        Color.white.opacity(0.1)
                    )
                    .blendMode(.overlay)
                    .frame(width: 140, height: 180)
            }
        }
        .onAppear {
            if shouldPulse {
                withAnimation(Animation.easeInOut(duration: 2.0).repeatForever(autoreverses: true)) {
                    pulseOpacity = 0.6
                }
            }
        }
    }
}

struct EmptySlotView: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(Color(red: 0.3, green: 0.2, blue: 0.15))
            .frame(width: 140, height: 180)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.white.opacity(0.1), lineWidth: 1)
            )
    }
}