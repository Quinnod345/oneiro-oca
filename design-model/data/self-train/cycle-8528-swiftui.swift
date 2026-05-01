struct ContentView: View {
    @State private var placedWaveforms: [WaveformShape] = []
    @State private var draggedWaveform: WaveformShape?
    @State private var dragOffset: CGSize = .zero
    @State private var generatedRecipe: String = ""
    @State private var showRecipe: Bool = false
    @State private var interferencePatterns: [InterferencePattern] = []
    @State private var harmonicPulse: Double = 0
    
    let frequencyBands = [
        FrequencyBand(range: 20...250, taste: "Umami", color: Color(red: 0.4, green: 0.2, blue: 0.1), baseHue: 30),
        FrequencyBand(range: 250...2000, taste: "Sweet", color: Color(red: 0.9, green: 0.6, blue: 0.3), baseHue: 40),
        FrequencyBand(range: 2000...4000, taste: "Sour", color: Color(red: 0.7, green: 0.9, blue: 0.2), baseHue: 80),
        FrequencyBand(range: 4000...8000, taste: "Bitter", color: Color(red: 0.3, green: 0.6, blue: 0.3), baseHue: 120),
        FrequencyBand(range: 8000...20000, taste: "Salt", color: Color(red: 0.8, green: 0.8, blue: 0.9), baseHue: 220)
    ]
    
    let ingredientLibrary: [Ingredient] = [
        Ingredient(name: "Mushroom", dominantFrequency: 80, harmonics: [160, 240]),
        Ingredient(name: "Honey", dominantFrequency: 800, harmonics: [1600, 2400]),
        Ingredient(name: "Lemon", dominantFrequency: 3000, harmonics: [6000, 9000]),
        Ingredient(name: "Coffee", dominantFrequency: 5000, harmonics: [10000, 15000]),
        Ingredient(name: "Sea Salt", dominantFrequency: 12000, harmonics: [16000])
    ]
    
    var body: some View {
        ZStack {
            Color(red: 0.05, green: 0.05, blue: 0.08)
                .ignoresSafeArea()
            
            HStack(spacing: 0) {
                VStack(spacing: 0) {
                    Text("FREQUENCY SPECTRUM")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(Color(red: 0.7, green: 0.7, blue: 0.8))
                        .padding(.vertical, 20)
                    
                    ForEach(frequencyBands) { band in
                        FrequencyBandView(band: band, harmonicPulse: harmonicPulse)
                            .frame(height: 140)
                    }
                }
                .frame(width: 280)
                .background(Color(red: 0.08, green: 0.08, blue: 0.12))
                
                ZStack {
                    Canvas { context, size in
                        for x in stride(from: 0, through: size.width, by: 40) {
                            let path = Path { p in
                                p.move(to: CGPoint(x: x, y: 0))
                                p.addLine(to: CGPoint(x: x, y: size.height))
                            }
                            context.stroke(path, with: .color(Color(red: 0.15, green: 0.15, blue: 0.2)), lineWidth: 0.5)
                        }
                        for y in stride(from: 0, through: size.height, by: 40) {
                            let path = Path { p in
                                p.move(to: CGPoint(x: 0, y: y))
                                p.addLine(to: CGPoint(x: size.width, y: y))
                            }
                            context.stroke(path, with: .color(Color(red: 0.15, green: 0.15, blue: 0.2)), lineWidth: 0.5)
                        }
                    }
                    
                    Circle()
                        .stroke(Color(red: 0.3, green: 0.3, blue: 0.4), lineWidth: 2)
                        .frame(width: 500, height: 500)
                        .overlay(
                            Circle()
                                .fill(Color(red: 0.1, green: 0.1, blue: 0.15).opacity(0.3))
                        )
                    
                    ForEach(interferencePatterns) { pattern in
                        InterferenceView(pattern: pattern)
                    }
                    
                    ForEach(placedWaveforms) { waveform in
                        PlacedWaveformView(waveform: waveform)
                            .position(waveform.position)
                    }
                    
                    if let dragged = draggedWaveform {
                        PlacedWaveformView(waveform: dragged)
                            .offset(dragOffset)
                            .opacity(0.8)
                    }
                }
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
                .onDrop(of: ["waveform"], isTargeted: nil) { providers in
                    return true
                }
                
                VStack(spacing: 0) {
                    Text("WAVEFORM PALETTE")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(Color(red: 0.7, green: 0.7, blue: 0.8))
                        .padding(.vertical, 20)
                    
                    ScrollView {
                        VStack(spacing: 30) {
                            ForEach(WaveformShape.WaveType.allCases, id: \.self) { type in
                                WaveformPaletteItem(type: type, onDrag: { freq in
                                    draggedWaveform = WaveformShape(
                                        position: CGPoint(x: 720, y: 450),
                                        frequency: freq,
                                        amplitude: 0.8,
                                        phase: 0,
                                        type: type
                                    )
                                })
                            }
                        }
                        .padding(20)
                    }
                }
                .frame(width: 180)
                .background(Color(red: 0.08, green: 0.08, blue: 0.12))
            }
        }
    }
}