struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(title: "Morning Coffee", addedDate: Calendar.current.date(byAdding: .hour, value: -8, to: Date()) ?? Date(), color: Color(red: 0.6, green: 0.3, blue: 0.2)),
        ShelfItem(title: "Garden Notes", addedDate: Calendar.current.date(byAdding: .day, value: -2, to: Date()) ?? Date(), color: Color(red: 0.2, green: 0.5, blue: 0.3)),
        ShelfItem(title: "Recipe Collection", addedDate: Calendar.current.date(byAdding: .day, value: -4, to: Date()) ?? Date(), color: Color(red: 0.7, green: 0.5, blue: 0.2)),
        ShelfItem(title: "Travel Memories", addedDate: Calendar.current.date(byAdding: .day, value: -6, to: Date()) ?? Date(), color: Color(red: 0.4, green: 0.2, blue: 0.6)),
        ShelfItem(title: "Old Letters", addedDate: Calendar.current.date(byAdding: .day, value: -8, to: Date()) ?? Date(), color: Color(red: 0.5, green: 0.4, blue: 0.3)),
        ShelfItem(title: "Poetry Draft", addedDate: Calendar.current.date(byAdding: .day, value: -10, to: Date()) ?? Date(), color: Color(red: 0.3, green: 0.4, blue: 0.5))
    ]
    
    @State private var dustParticles: [DustParticle] = []
    @State private var breatheScale: CGFloat = 1.0
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Warm wooden background
                LinearGradient(
                    stops: [
                        .init(color: Color(red: 0.85, green: 0.72, blue: 0.55), location: 0),
                        .init(color: Color(red: 0.78, green: 0.65, blue: 0.48), location: 0.4),
                        .init(color: Color(red: 0.82, green: 0.69, blue: 0.52), location: 0.6),
                        .init(color: Color(red: 0.76, green: 0.63, blue: 0.46), location: 1)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()
                
                // Wood grain texture overlay
                ZStack {
                    ForEach(0..<12, id: \.self) { index in
                        Rectangle()
                            .fill(Color(red: 0.7, green: 0.55, blue: 0.4))
                            .opacity(0.08)
                            .frame(height: 3)
                            .offset(y: CGFloat(index * 75) - 400)
                            .blur(radius: 1)
                    }
                }
                
                // Shelf items arranged in a gentle arc
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    let angle = (Double(index) - 2.5) * 0.15
                    let radius: CGFloat = 180
                    let baseX = geometry.size.width / 2
                    let baseY = geometry.size.height / 2
                    let x = baseX + cos(angle) * radius
                    let y = baseY + sin(angle) * radius * 0.3
                    
                    ZStack {
                        // Item shadow on shelf
                        RoundedRectangle(cornerRadius: 16)
                            .fill(Color.black.opacity(0.15))
                            .frame(width: 140, height: 180)
                            .offset(x: 2, y: 8)
                            .blur(radius: 4)
                        
                        // Main item
                        RoundedRectangle(cornerRadius: 16)
                            .fill(item.color)
                            .frame(width: 140, height: 180)
                            .overlay(
                                // Patina overlay
                                RoundedRectangle(cornerRadius: 16)
                                    .fill(item.patina)
                                    .blendMode(.overlay)
                            )
                            .overlay(
                                // Subtle inner shadow for depth
                                RoundedRectangle(cornerRadius: 16)
                                    .stroke(
                                        LinearGradient(
                                            colors: [Color.white.opacity(0.3), Color.clear],
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        ),
                                        lineWidth: 1
                                    )
                            )
                            .opacity(item.opacity)
                            .scaleEffect(item.isFresh ? breatheScale : 1.0)
                            .animation(.easeInOut(duration: 3).repeatForever(autoreverses: true), value: breatheScale)
                        
                        // Item title
                        Text(item.title)
                            .font(.system(size: 14, weight: .medium, design: .serif))
                            .foregroundColor(Color.white.opacity(0.9))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 12)
                            .opacity(item.opacity)
                        
                        // Dust particles for old items
                        if item.showDustParticles {
                            ForEach(dustParticles.prefix(8)) { particle in
                                Circle()
                                    .fill(Color(red: 0.9, green: 0.85, blue: 0.7))
                                    .frame(width: particle.size, height: particle.size)
                                    .opacity(particle.opacity * 0.6)
                                    .offset(particle.offset)
                                    .blur(radius: 0.5)
                            }
                        }
                    }
                    .position(x: x, y: y)
                    .rotationEffect(.radians(angle * 0.3))
                }
                
                // Ambient lighting effect
                RadialGradient(
                    colors: [
                        Color(red: 0.95, green: 0.88, blue: 0.75).opacity(0.2),
                        Color.clear
                    ],
                    center: UnitPoint(x: 0.3, y: 0.2),
                    startRadius: 50,
                    endRadius: 400
                )
                .ignoresSafeArea()
            }
        }
        .onAppear {
            generateDustParticles()
            startBreathing()
        }
    }
    
    private func generateDustParticles() {
        dustParticles = (0..<20).map { _ in
            DustParticle(
                offset: CGPoint(
                    x: Double.random(in: -60...60),
                    y: Double.random(in: -80...80)
                ),
                size: CGFloat.random(in: 1...3),
                opacity: Double.random(in: 0.2...0.5)
            )
        }
    }
    
    private func startBreathing() {
        breatheScale = 0.95
    }
}