struct ContentView: View {
    @State private var sleeplessHours: Int = 0
    @State private var events: [TimelineEvent] = []
    @State private var currentDistortion: CGFloat = 0
    @State private var sleepCycles: CGFloat = 0
    @State private var inputText: String = ""
    @State private var showingReset: Bool = false
    
    var maxDistortion: CGFloat {
        min(CGFloat(sleeplessHours) / 72.0, 1.0)
    }
    
    var body: some View {
        ZStack {
            // Background gradient that shifts with exhaustion
            LinearGradient(
                colors: [
                    Color(red: 0.98 - maxDistortion * 0.1, green: 0.97 - maxDistortion * 0.1, blue: 0.95 - maxDistortion * 0.05),
                    Color(red: 0.95 - maxDistortion * 0.2, green: 0.93 - maxDistortion * 0.15, blue: 0.90 - maxDistortion * 0.1)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            
            // Warped grid overlay
            WarpedGrid(distortion: currentDistortion)
                .ignoresSafeArea()
            
            VStack(spacing: 40) {
                // Title that deteriorates
                HStack(spacing: 2) {
                    ForEach(Array("Dream Decay Calculator".enumerated()), id: \.offset) { index, character in
                        Text(String(character))
                            .font(.system(size: 36, weight: .thin, design: .serif))
                            .foregroundColor(Color(red: 0.1, green: 0.08, blue: 0.06))
                            .offset(
                                x: currentDistortion * sin(Double(index) * 0.3) * 5,
                                y: currentDistortion * cos(Double(index) * 0.5) * 8
                            )
                            .rotationEffect(.degrees(currentDistortion * sin(Double(index) * 0.2) * 10))
                            .opacity(1.0 - currentDistortion * 0.2)
                    }
                }
                .padding(.top, 40)
                
                // Melting clocks
                HStack(spacing: 60) {
                    ForEach(0..<3) { index in
                        MeltingClock(distortion: currentDistortion * (1.0 + CGFloat(index) * 0.2), time: Date())
                            .frame(width: 120, height: 120)
                            .offset(y: currentDistortion * CGFloat(index) * 20)
                    }
                }
                
                // Input section with fragmentation
                VStack(spacing: 20) {
                    FloatingText(text: "Hours without sleep:", drift: currentDistortion)
                    
                    FragmentedInput(
                        value: Binding(
                            get: { String(sleeplessHours) },
                            set: { newValue in
                                if let hours = Int(newValue) {
                                    sleeplessHours = max(0, min(168, hours))
                                    withAnimation(.easeInOut(duration: 2)) {
                                        currentDistortion = maxDistortion
                                    }
                                }
                            }
                        ),
                        fragmentation: currentDistortion,
                        placeholder: "0"
                    )
                    .frame(width: 200)
                }
                
                // Distortion meter
                VStack(spacing: 10) {
                    Text("Reality Distortion")
                        .font(.system(size: 14, weight: .light, design: .monospaced))
                        .foregroundColor(Color(red: 0.3, green: 0.25, blue: 0.2))
                        .opacity(1.0 - currentDistortion * 0.3)
                    
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color(red: 0.9, green: 0.88, blue: 0.85).opacity(0.3))
                            .frame(width: 400, height: 20)
                        
                        RoundedRectangle(cornerRadius: 10)
                            .fill(
                                LinearGradient(
                                    colors: [
                                        Color(red: 0.4, green: 0.6, blue: 0.8),
                                        Color(red: 0.6, green: 0.4, blue: 0.6),
                                        Color(red: 0.8, green: 0.3, blue: 0.4)
                                    ],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .frame(width: 400 * currentDistortion, height: 20)
                            .animation(.easeInOut(duration: 1), value: currentDistortion)
                    }
                }
                
                // Kaleidoscopic buttons
                HStack(spacing: 30) {
                    ForEach(["Calculate", "Reset", "Sleep"], id: \.self) { label in
                        ZStack {
                            ForEach(0..<max(1, Int(currentDistortion * 4))) { index in
                                Button(action: {
                                    if label == "Reset" {
                                        sleeplessHours = 0
                                        withAnimation(.easeInOut(duration: 1)) {
                                            currentDistortion = 0
                                        }
                                    }
                                }) {
                                    Text(label)
                                        .font(.system(size: 16, weight: .medium, design: .default))
                                        .foregroundColor(Color.white)
                                        .padding(.horizontal, 20)
                                        .padding(.vertical, 10)
                                        .background(
                                            RoundedRectangle(cornerRadius: 20)
                                                .fill(Color(red: 0.3, green: 0.25, blue: 0.35))
                                        )
                                }
                                .opacity(index == 0 ? 1.0 : 0.3)
                                .offset(
                                    x: CGFloat(index) * currentDistortion * 10,
                                    y: CGFloat(index) * currentDistortion * 5
                                )
                                .rotationEffect(.degrees(Double(index) * currentDistortion * 15))
                            }
                        }
                    }
                }
                
                Spacer()
            }
            .padding()
        }
    }
}

struct WarpedGrid: View {
    let distortion: CGFloat
    
    var body: some View {
        GeometryReader { geometry in
            Canvas { context, size in
                let gridSize: CGFloat = 50
                let rows = Int(size.height / gridSize) + 2
                let cols = Int(size.width / gridSize) + 2
                
                for row in 0..<rows {
                    var path = Path()
                    for col in 0..<cols {
                        let x = CGFloat(col) * gridSize
                        let y = CGFloat(row) * gridSize
                        let offset = sin(Double(col) * 0.1) * Double(distortion) * 20
                        
                        if col == 0 {
                            path.move(to: CGPoint(x: x, y: y + offset))
                        } else {
                            path.addLine(to: CGPoint(x: x, y: y + offset))
                        }
                    }
                    context.stroke(path, with: .color(Color.gray.opacity(0.2 - distortion * 0.1)))
                }
                
                for col in 0..<cols {
                    var path = Path()
                    for row in 0..<rows {
                        let x = CGFloat(col) * gridSize
                        let y = CGFloat(row) * gridSize
                        let offset = cos(Double(row) * 0.1) * Double(distortion) * 20
                        
                        if row == 0 {
                            path.move(to: CGPoint(x: x + offset, y: y))
                        } else {
                            path.addLine(to: CGPoint(x: x + offset, y: y))
                        }
                    }
                    context.stroke(path, with: .color(Color.gray.opacity(0.2 - distortion * 0.1)))
                }
            }
        }
    }
}

struct MeltingClock: View {
    let distortion: CGFloat
    let time: Date
    
    var body: some View {
        ZStack {
            Circle()
                .fill(Color.white)
                .overlay(
                    Circle()
                        .stroke(Color(red: 0.2, green: 0.15, blue: 0.1), lineWidth: 2)
                )
                .scaleEffect(1.0 + distortion * 0.2)
                .offset(y: distortion * 30)
            
            ForEach(0..<12) { hour in
                Text("\(hour == 0 ? 12 : hour)")
                    .font(.system(size: 12, weight: .regular, design: .serif))
                    .offset(y: -40)
                    .rotationEffect(.degrees(Double(hour) * 30))
                    .offset(y: distortion * sin(Double(hour) * 0.5) * 10)
                    .opacity(1.0 - distortion * 0.3)
            }
            
            // Hour hand
            Rectangle()
                .fill(Color.black)
                .frame(width: 3, height: 30)
                .offset(y: -15)
                .rotationEffect(.degrees(Double(Calendar.current.component(.hour, from: time)) * 30 + distortion * 45))
            
            // Minute hand
            Rectangle()
                .fill(Color.black)
                .frame(width: 2, height: 40)
                .offset(y: -20)
                .rotationEffect(.degrees(Double(Calendar.current.component(.minute, from: time)) * 6 + distortion * 90))
        }
    }
}

struct FloatingText: View {
    let text: String
    let drift: CGFloat
    
    var body: some View {
        Text(text)
            .font(.system(size: 18, weight: .light, design: .serif))
            .foregroundColor(Color(red: 0.2, green: 0.15, blue: 0.1))
            .offset(
                x: sin(Date().timeIntervalSince1970) * Double(drift) * 10,
                y: cos(Date().timeIntervalSince1970 * 0.7) * Double(drift) * 5
            )
            .animation(.easeInOut(duration: 3).repeatForever(autoreverses: true), value: drift)
    }
}

struct FragmentedInput: View {
    @Binding var value: String
    let fragmentation: CGFloat
    let placeholder: String
    
    var body: some View {
        TextField(placeholder, text: $value)
            .textFieldStyle(RoundedBorderTextFieldStyle())
            .scaleEffect(1.0 + fragmentation * 0.1)
            .overlay(
                ForEach(0..<max(1, Int(fragmentation * 3))) { index in
                    TextField(placeholder, text: .constant(""))
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                        .opacity(0.2)
                        .offset(
                            x: CGFloat(index) * fragmentation * 20 - 10,
                            y: CGFloat(index) * fragmentation * 10 - 5
                        )
                        .allowsHitTesting(false)
                }
            )
    }
}