struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(name: "Notes", age: 300, icon: "📝"),
        ShelfItem(name: "Photos", age: 600, icon: "📷"),
        ShelfItem(name: "Music", age: 1800, icon: "🎵"),
        ShelfItem(name: "Mail", age: 2400, icon: "✉️"),
        ShelfItem(name: "Calendar", age: 3200, icon: "📅")
    ]
    
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                ForEach(items) { item in
                    SlotView(item: item)
                }
                
                ForEach(0..<(8 - items.count), id: \.self) { _ in
                    EmptySlotView()
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .frame(width: 720, height: 120)
        .background(
            ZStack {
                LinearGradient(
                    gradient: Gradient(colors: [
                        Color(red: 0.96, green: 0.92, blue: 0.82),
                        Color(red: 0.94, green: 0.89, blue: 0.76)
                    ]),
                    startPoint: .top,
                    endPoint: .bottom
                )
                
                LinearGradient(
                    gradient: Gradient(stops: [
                        .init(color: Color(red: 0.98, green: 0.94, blue: 0.84).opacity(0.7), location: 0.0),
                        .init(color: Color.clear, location: 0.3),
                        .init(color: Color.clear, location: 0.7),
                        .init(color: Color(red: 0.88, green: 0.82, blue: 0.68).opacity(0.4), location: 1.0)
                    ]),
                    startPoint: UnitPoint(x: 0, y: 0),
                    endPoint: UnitPoint(x: 1, y: 0.3)
                )
            }
        )
    }
}

struct SlotView: View {
    let item: ShelfItem
    
    var body: some View {
        VStack(spacing: 4) {
            Text(item.icon)
                .font(.system(size: 24))
                .opacity(item.opacity)
            
            Text(item.name)
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundColor(Color(red: 0.45, green: 0.35, blue: 0.25))
                .opacity(item.opacity * 0.8)
        }
        .frame(width: 80, height: 80)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(red: 0.91, green: 0.86, blue: 0.74))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color(red: 0.98, green: 0.95, blue: 0.87), lineWidth: 1)
                        .blur(radius: 0.5)
                        .offset(y: -0.5)
                )
                .shadow(color: Color(red: 0.78, green: 0.72, blue: 0.58).opacity(0.6), radius: 3, x: 0, y: 2)
                .shadow(color: Color(red: 0.85, green: 0.79, blue: 0.65).opacity(0.8), radius: 1, x: 0, y: 1)
        )
    }
}

struct EmptySlotView: View {
    var body: some View {
        Rectangle()
            .fill(Color.clear)
            .frame(width: 80, height: 80)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color(red: 0.89, green: 0.84, blue: 0.72))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color(red: 0.95, green: 0.91, blue: 0.82), lineWidth: 1)
                            .blur(radius: 0.5)
                            .offset(y: -0.5)
                    )
                    .shadow(color: Color(red: 0.76, green: 0.70, blue: 0.56).opacity(0.5), radius: 2, x: 0, y: 1.5)
                    .shadow(color: Color(red: 0.83, green: 0.77, blue: 0.63).opacity(0.7), radius: 1, x: 0, y: 1)
            )
    }
}