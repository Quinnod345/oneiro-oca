struct ContentView: View {
    @State private var selectedFrequency: Double = 1000
    @State private var tasteIntensity: Double = 0.5
    @State private var harmonicLayers: [HarmonicLayer] = []
    @State private var isInteracting: Bool = false
    
    let tasteGradients = [
        TasteProfile(name: "Umami", range: 20...250, color: Color(hue: 0.08, saturation: 0.25, brightness: 0.7)),
        TasteProfile(name: "Sweet", range: 250...2000, color: Color(hue: 0.12, saturation: 0.35, brightness: 0.85)),
        TasteProfile(name: "Sour", range: 2000...4000, color: Color(hue: 0.25, saturation: 0.4, brightness: 0.8)),
        TasteProfile(name: "Bitter", range: 4000...8000, color: Color(hue: 0.35, saturation: 0.3, brightness: 0.65)),
        TasteProfile(name: "Salt", range: 8000...20000, color: Color(hue: 0.6, saturation: 0.15, brightness: 0.9))
    ]
    
    var currentTaste: TasteProfile? {
        tasteGradients.first { $0.range.contains(Int(selectedFrequency)) }
    }
    
    var body: some View {
        ZStack {
            LinearGradient(colors: [
                Color(white: 0.98),
                Color(white: 0.95)
            ], startPoint: .top, endPoint: .bottom)
            .ignoresSafeArea()
            
            VStack(spacing: 60) {
                Text("Frequency to Taste")
                    .font(.system(size: 32, weight: .thin, design: .rounded))
                    .foregroundColor(.black.opacity(0.8))
                    .padding(.top, 40)
                
                ZStack {
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    currentTaste?.color.opacity(tasteIntensity * 0.3) ?? Color.clear,
                                    currentTaste?.color.opacity(tasteIntensity * 0.1) ?? Color.clear,
                                    Color.clear
                                ],
                                center: .center,
                                startRadius: 0,
                                endRadius: 200
                            )
                        )
                        .frame(width: 400, height: 400)
                        .blur(radius: 20)
                        .animation(.easeInOut(duration: 0.8), value: selectedFrequency)
                    
                    ForEach(harmonicLayers) { layer in
                        Circle()
                            .stroke(
                                layer.color.opacity(0.3),
                                lineWidth: 2
                            )
                            .frame(width: layer.radius * 2, height: layer.radius * 2)
                            .scaleEffect(layer.scale)
                            .opacity(layer.opacity)
                            .animation(.easeOut(duration: 1.5), value: layer.scale)
                    }
                    
                    Circle()
                        .fill(Color.white)
                        .frame(width: 80, height: 80)
                        .shadow(color: currentTaste?.color.opacity(0.3) ?? Color.clear, radius: 20)
                        .overlay(
                            Text("\(Int(selectedFrequency))")
                                .font(.system(size: 18, weight: .medium, design: .rounded))
                                .foregroundColor(.black.opacity(0.7))
                        )
                        .scaleEffect(isInteracting ? 1.1 : 1.0)
                        .animation(.easeInOut(duration: 0.2), value: isInteracting)
                }
                
                VStack(spacing: 30) {
                    Text(currentTaste?.name ?? "—")
                        .font(.system(size: 24, weight: .light, design: .rounded))
                        .foregroundColor(.black.opacity(0.8))
                        .animation(.easeInOut(duration: 0.3), value: currentTaste?.name)
                    
                    VStack(spacing: 15) {
                        HStack {
                            Text("Frequency")
                                .font(.system(size: 14, weight: .regular, design: .rounded))
                                .foregroundColor(.black.opacity(0.5))
                            Spacer()
                            Text("\(Int(selectedFrequency)) Hz")
                                .font(.system(size: 14, weight: .medium, design: .rounded))
                                .foregroundColor(.black.opacity(0.7))
                        }
                        
                        Slider(value: $selectedFrequency, in: 20...20000) { editing in
                            isInteracting = editing
                            if !editing {
                                addHarmonicRipple()
                            }
                        }
                        .accentColor(currentTaste?.color ?? Color.gray)
                    }
                    .padding(.horizontal, 40)
                    .frame(maxWidth: 500)
                }
                
                Spacer()
            }
        }
        .onAppear {
            Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { _ in
                if !isInteracting {
                    addHarmonicRipple()
                }
            }
        }
    }
    
    func addHarmonicRipple() {
        let newLayer = HarmonicLayer(
            radius: 40,
            color: currentTaste?.color ?? Color.gray,
            scale: 1.0,
            opacity: 0.6
        )
        harmonicLayers.append(newLayer)
        
        withAnimation(.easeOut(duration: 2.0)) {
            if let index = harmonicLayers.firstIndex(where: { $0.id == newLayer.id }) {
                harmonicLayers[index].scale = 5.0
                harmonicLayers[index].opacity = 0
            }
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            harmonicLayers.removeAll { $0.id == newLayer.id }
        }
    }
}

struct TasteProfile {
    let name: String
    let range: ClosedRange<Int>
    let color: Color
}

struct HarmonicLayer: Identifiable {
    let id = UUID()
    var radius: CGFloat
    var color: Color
    var scale: CGFloat
    var opacity: Double
}