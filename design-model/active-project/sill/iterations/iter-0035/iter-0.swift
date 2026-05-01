struct ContentView: View {
    @State private var items: [WindowsillItem] = [
        WindowsillItem(title: "Morning Notes", createdAt: Date().addingTimeInterval(-86400 * 1)),
        WindowsillItem(title: "Project Ideas", createdAt: Date().addingTimeInterval(-86400 * 4)),
        WindowsillItem(title: "Reading List", createdAt: Date().addingTimeInterval(-86400 * 7)),
        WindowsillItem(title: "Quick Thoughts", createdAt: Date().addingTimeInterval(-86400 * 0.5)),
        WindowsillItem(title: "Meeting Notes", createdAt: Date().addingTimeInterval(-86400 * 6))
    ]
    
    var body: some View {
        ZStack {
            LinearGradient(
                gradient: Gradient(colors: [
                    Color(red: 0.92, green: 0.85, blue: 0.72),
                    Color(red: 0.88, green: 0.78, blue: 0.62)
                ]),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            
            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Windowsill")
                            .font(.system(size: 28, weight: .light, design: .serif))
                            .foregroundColor(Color(red: 0.25, green: 0.2, blue: 0.15))
                        
                        Text("Things settle here")
                            .font(.system(size: 12, weight: .regular, design: .default))
                            .foregroundColor(Color(red: 0.4, green: 0.35, blue: 0.3))
                            .opacity(0.8)
                    }
                    
                    Spacer()
                    
                    Text("\(items.count)/8")
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(
                            Capsule()
                                .fill(Color(red: 0.9, green: 0.85, blue: 0.75))
                                .opacity(0.6)
                        )
                }
                .padding(.horizontal, 40)
                .padding(.top, 40)
                
                Spacer()
                
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 20), count: 4), spacing: 30) {
                    ForEach(items) { item in
                        WindowsillItemView(item: item)
                    }
                }
                .padding(.horizontal, 40)
                
                Spacer()
                
                HStack {
                    Circle()
                        .fill(Color(red: 0.2, green: 0.7, blue: 0.3))
                        .frame(width: 6, height: 6)
                    
                    Text("Fresh")
                        .font(.system(size: 10, weight: .medium, design: .default))
                        .foregroundColor(Color(red: 0.4, green: 0.35, blue: 0.3))
                    
                    Circle()
                        .fill(Color(red: 0.8, green: 0.6, blue: 0.2))
                        .frame(width: 6, height: 6)
                        .padding(.leading, 12)
                    
                    Text("Settling")
                        .font(.system(size: 10, weight: .medium, design: .default))
                        .foregroundColor(Color(red: 0.4, green: 0.35, blue: 0.3))
                    
                    Circle()
                        .fill(Color(red: 0.6, green: 0.5, blue: 0.4))
                        .frame(width: 6, height: 6)
                        .padding(.leading, 12)
                    
                    Text("Weathered")
                        .font(.system(size: 10, weight: .medium, design: .default))
                        .foregroundColor(Color(red: 0.4, green: 0.35, blue: 0.3))
                }
                .padding(.bottom, 30)
            }
        }
        .frame(width: 1440, height: 900)
    }
}