struct ContentView: View {
    @State private var leftWeights: [ArgumentWeight] = []
    @State private var rightWeights: [ArgumentWeight] = []
    @State private var pendingWeight: ArgumentWeight?
    @State private var scaleAngle: Double = 0
    @State private var targetAngle: Double = 0
    @State private var fulcrumGlow: Double = 0.5
    @State private var isEquilibrium: Bool = false
    @State private var frozenTime: Double = 0
    @State private var argumentText: String = ""
    @State private var selectedSide: Side = .left
    @State private var draggedWeight: ArgumentWeight?
    @State private var scaleCreak: Double = 0
    
    let scaleWidth: CGFloat = 600
    let scaleHeight: CGFloat = 40
    let fulcrumHeight: CGFloat = 300
    
    var totalLeftMass: CGFloat {
        leftWeights.reduce(0) { $0 + $1.mass }
    }
    
    var totalRightMass: CGFloat {
        rightWeights.reduce(0) { $0 + $1.mass }
    }
    
    var body: some View {
        ZStack {
            // Ancient parchment background
            LinearGradient(
                colors: [
                    Color(red: 0.95, green: 0.92, blue: 0.86),
                    Color(red: 0.91, green: 0.87, blue: 0.79)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            
            // Dust particles
            ForEach(0..<20, id: \.self) { i in
                Circle()
                    .fill(Color(red: 0.8, green: 0.75, blue: 0.65))
                    .frame(width: 2, height: 2)
                    .opacity(0.3)
                    .offset(
                        x: sin(frozenTime * 0.3 + Double(i)) * 200,
                        y: cos(frozenTime * 0.2 + Double(i) * 2) * 150
                    )
            }
            
            VStack(spacing: 0) {
                // Title area
                Text("The Argument Settler")
                    .font(.system(size: 42, weight: .thin, design: .serif))
                    .foregroundColor(Color(red: 0.3, green: 0.25, blue: 0.2))
                    .opacity(isEquilibrium ? 0.3 : 1.0)
                    .padding(.top, 40)
                
                // Main scale area
                ZStack {
                    // Fulcrum
                    VStack(spacing: 0) {
                        Rectangle()
                            .fill(
                                LinearGradient(
                                    colors: [
                                        Color(red: 0.7 + fulcrumGlow * 0.3, green: 0.5 + fulcrumGlow * 0.3, blue: 0.3),
                                        Color(red: 0.5 + fulcrumGlow * 0.5, green: 0.4 + fulcrumGlow * 0.4, blue: 0.2)
                                    ],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .frame(width: 4, height: fulcrumHeight)
                            .shadow(color: Color(red: 0.9, green: 0.7, blue: 0.4).opacity(fulcrumGlow), radius: 20)
                        
                        Path { path in
                            path.move(to: CGPoint(x: 0, y: 0))
                            path.addLine(to: CGPoint(x: -30, y: 40))
                            path.addLine(to: CGPoint(x: 30, y: 40))
                            path.closeSubpath()
                        }
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.6 + fulcrumGlow * 0.4, green: 0.45 + fulcrumGlow * 0.35, blue: 0.25),
                                    Color(red: 0.4 + fulcrumGlow * 0.6, green: 0.3 + fulcrumGlow * 0.5, blue: 0.15)
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                    }
                    .offset(y: -fulcrumHeight/2 + 100)
                    
                    // Scale beam
                    ZStack {
                        Rectangle()
                            .fill(
                                LinearGradient(
                                    colors: [
                                        Color(red: 0.45, green: 0.4, blue: 0.35),
                                        Color(red: 0.35, green: 0.3, blue: 0.25),
                                        Color(red: 0.45, green: 0.4, blue: 0.35)
                                    ],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                            )
                            .frame(width: scaleWidth, height: scaleHeight)
                            .overlay(
                                // Wood grain texture
                                ForEach(0..<10, id: \.self) { i in
                                    Rectangle()
                                        .fill(Color(red: 0.3, green: 0.25, blue: 0.2))
                                        .frame(width: scaleWidth, height: 1)
                                        .opacity(0.2)
                                        .offset(y: CGFloat(i - 5) * 4)
                                }
                            )
                        
                        // Scale plates
                        HStack(spacing: scaleWidth - 200) {
                            // Left plate
                            ZStack {
                                Circle()
                                    .stroke(Color(red: 0.5, green: 0.45, blue: 0.4), lineWidth: 3)
                                    .frame(width: 120, height: 120)
                                Circle()
                                    .fill(
                                        RadialGradient(
                                            colors: [
                                                Color(red: 0.85, green: 0.8, blue: 0.75),
                                                Color(red: 0.7, green: 0.65, blue: 0.6)
                                            ],
                                            center: .center,
                                            startRadius: 5,
                                            endRadius: 60
                                        )
                                    )
                                    .frame(width: 110, height: 110)
                                
                                ForEach(leftWeights) { weight in
                                    Text(weight.text)
                                        .font(.caption)
                                        .foregroundColor(Color(red: 0.2, green: 0.15, blue: 0.1))
                                        .padding(4)
                                        .background(Color(red: 0.9, green: 0.85, blue: 0.8))
                                        .cornerRadius(4)
                                        .offset(x: weight.x, y: weight.y)
                                }
                            }
                            
                            // Right plate
                            ZStack {
                                Circle()
                                    .stroke(Color(red: 0.5, green: 0.45, blue: 0.4), lineWidth: 3)
                                    .frame(width: 120, height: 120)
                                Circle()
                                    .fill(
                                        RadialGradient(
                                            colors: [
                                                Color(red: 0.85, green: 0.8, blue: 0.75),
                                                Color(red: 0.7, green: 0.65, blue: 0.6)
                                            ],
                                            center: .center,
                                            startRadius: 5,
                                            endRadius: 60
                                        )
                                    )
                                    .frame(width: 110, height: 110)
                                
                                ForEach(rightWeights) { weight in
                                    Text(weight.text)
                                        .font(.caption)
                                        .foregroundColor(Color(red: 0.2, green: 0.15, blue: 0.1))
                                        .padding(4)
                                        .background(Color(red: 0.9, green: 0.85, blue: 0.8))
                                        .cornerRadius(4)
                                        .offset(x: weight.x, y: weight.y)
                                }
                            }
                        }
                    }
                    .rotationEffect(.degrees(scaleAngle))
                    .offset(y: -fulcrumHeight/2 + 20)
                }
                .frame(height: fulcrumHeight)
                
                // Control area
                VStack(spacing: 20) {
                    HStack {
                        TextField("Enter argument...", text: $argumentText)
                            .textFieldStyle(RoundedBorderTextFieldStyle())
                            .frame(width: 300)
                        
                        Picker("Side", selection: $selectedSide) {
                            Text("Left").tag(Side.left)
                            Text("Right").tag(Side.right)
                        }
                        .pickerStyle(SegmentedPickerStyle())
                        .frame(width: 150)
                        
                        Button("Add Argument") {
                            if !argumentText.isEmpty {
                                let weight = ArgumentWeight(
                                    text: argumentText,
                                    mass: CGFloat(argumentText.count) * 5,
                                    x: CGFloat.random(in: -30...30),
                                    y: CGFloat.random(in: -30...30)
                                )
                                
                                withAnimation(.spring()) {
                                    if selectedSide == .left {
                                        leftWeights.append(weight)
                                    } else {
                                        rightWeights.append(weight)
                                    }
                                    updateScale()
                                }
                                
                                argumentText = ""
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(Color(red: 0.8, green: 0.7, blue: 0.6))
                        .foregroundColor(Color(red: 0.2, green: 0.15, blue: 0.1))
                        .cornerRadius(8)
                    }
                    
                    HStack(spacing: 40) {
                        VStack {
                            Text("Left: \(Int(totalLeftMass))g")
                                .font(.headline)
                                .foregroundColor(Color(red: 0.3, green: 0.25, blue: 0.2))
                        }
                        
                        VStack {
                            Text("Right: \(Int(totalRightMass))g")
                                .font(.headline)
                                .foregroundColor(Color(red: 0.3, green: 0.25, blue: 0.2))
                        }
                    }
                    
                    if isEquilibrium {
                        Text("Perfect Balance Achieved!")
                            .font(.title2)
                            .foregroundColor(Color(red: 0.8, green: 0.6, blue: 0.2))
                            .transition(.scale)
                    }
                }
                .padding()
            }
        }
        .onAppear {
            Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { _ in
                frozenTime += 0.016
                
                // Animate scale
                let diff = targetAngle - scaleAngle
                scaleAngle += diff * 0.1
                
                // Update glow
                fulcrumGlow = 0.5 + sin(frozenTime * 2) * 0.3
            }
        }
    }
    
    func updateScale() {
        let massDiff = totalLeftMass - totalRightMass
        targetAngle = Double(massDiff) * 0.1
        targetAngle = max(-15, min(15, targetAngle))
        
        isEquilibrium = abs(massDiff) < 5
    }
}