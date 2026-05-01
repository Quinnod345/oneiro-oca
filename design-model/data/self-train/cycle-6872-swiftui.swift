struct ContentView: View {
    @State private var apologyText: String = ""
    @State private var isComposing: Bool = true
    @State private var foldGestures: [FoldGesture] = []
    @State private var currentFold: FoldGesture?
    @State private var foldQuality: Double = 0
    @State private var planes: [PaperPlane] = []
    @State private var windows: [DistantWindow] = []
    @State private var hoveredWindow: UUID?
    @State private var throwPower: Double = 0
    @State private var throwAngle: Double = 0
    @State private var isDraggingThrow: Bool = false
    @State private var throwStart: CGPoint = .zero
    
    let cityColors = [
        Color(red: 0.15, green: 0.15, blue: 0.2),
        Color(red: 0.1, green: 0.1, blue: 0.15),
        Color(red: 0.05, green: 0.05, blue: 0.1)
    ]
    
    var body: some View {
        ZStack {
            // Night sky gradient
            LinearGradient(
                colors: [
                    Color(red: 0.02, green: 0.02, blue: 0.08),
                    Color(red: 0.05, green: 0.05, blue: 0.15),
                    Color(red: 0.08, green: 0.08, blue: 0.2)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            
            if isComposing {
                // Composition view
                VStack(spacing: 40) {
                    Text("What do you need to apologize for?")
                        .font(.system(size: 28, weight: .thin, design: .serif))
                        .foregroundColor(.white.opacity(0.9))
                        .padding(.top, 80)
                    
                    ZStack(alignment: .topLeading) {
                        if apologyText.isEmpty {
                            Text("I'm sorry for...")
                                .font(.system(size: 18, weight: .light))
                                .foregroundColor(.white.opacity(0.3))
                                .padding(.horizontal, 20)
                                .padding(.vertical, 16)
                        }
                        
                        TextEditor(text: $apologyText)
                            .font(.system(size: 18, weight: .light))
                            .foregroundColor(.white)
                            .scrollContentBackground(.hidden)
                            .background(Color.white.opacity(0.05))
                            .frame(width: 600, height: 120)
                            .cornerRadius(8)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color.white.opacity(0.1), lineWidth: 1)
                            )
                    }
                    
                    Button(action: { 
                        if !apologyText.isEmpty {
                            isComposing = false
                            generateWindows()
                        }
                    }) {
                        Text("Fold into paper plane")
                            .font(.system(size: 16, weight: .light))
                            .foregroundColor(.white.opacity(apologyText.isEmpty ? 0.3 : 0.9))
                            .padding(.horizontal, 32)
                            .padding(.vertical, 12)
                            .background(
                                RoundedRectangle(cornerRadius: 20)
                                    .fill(Color.white.opacity(apologyText.isEmpty ? 0.05 : 0.1))
                            )
                    }
                    .disabled(apologyText.isEmpty)
                    
                    Spacer()
                }
            } else {
                // City and folding view
                ZStack {
                    // Distant cityscape
                    ForEach(0..<5) { layer in
                        HStack(spacing: 0) {
                            ForEach(0..<20) { building in
                                Rectangle()
                                    .fill(cityColors[layer % 3])
                                    .frame(
                                        width: CGFloat.random(in: 40...120),
                                        height: CGFloat.random(in: 200...500)
                                    )
                                    .opacity(1.0 - Double(layer) * 0.15)
                            }
                        }
                        .offset(y: 400 + CGFloat(layer * 50))
                    }
                    
                    // Windows
                    ForEach(windows) { window in
                        Rectangle()
                            .fill(Color.yellow.opacity(window.isIlluminated ? 0.8 : 0.2))
                            .frame(width: 12, height: 16)
                            .position(window.position)
                            .scaleEffect(window.isIlluminated ? 1.5 : 1.0)
                            .animation(.easeOut(duration: 2.0), value: window.isIlluminated)
                    }
                    
                    // Flying paper planes
                    ForEach(planes) { plane in
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 20))
                            .foregroundColor(.white.opacity(plane.opacity))
                            .rotationEffect(.degrees(atan2(plane.velocity.dy, plane.velocity.dx) * 180 / .pi))
                            .position(plane.position)
                    }
                    
                    // Paper folding area
                    if foldGestures.count < 3 {
                        ZStack {
                            // Paper sheet
                            Rectangle()
                                .fill(Color.white.opacity(0.95))
                                .frame(width: 400, height: 400)
                                .overlay(
                                    VStack {
                                        Text("Fold the paper to create your plane")
                                            .font(.system(size: 14, weight: .light))
                                            .foregroundColor(.black.opacity(0.5))
                                            .padding(.top, 20)
                                        Spacer()
                                        Text("\(3 - foldGestures.count) folds remaining")
                                            .font(.system(size: 12))
                                            .foregroundColor(.black.opacity(0.3))
                                            .padding(.bottom, 20)
                                    }
                                )
                                .gesture(
                                    DragGesture()
                                        .onChanged { value in
                                            if currentFold == nil {
                                                currentFold = FoldGesture(start: value.startLocation, end: value.location)
                                            } else {
                                                currentFold?.end = value.location
                                            }
                                        }
                                        .onEnded { _ in
                                            if let fold = currentFold {
                                                foldGestures.append(fold)
                                                currentFold = nil
                                                if foldGestures.count == 3 {
                                                    calculateFoldQuality()
                                                }
                                            }
                                        }
                                )
                            
                            // Draw fold lines
                            ForEach(foldGestures) { fold in
                                Path { path in
                                    path.move(to: fold.start)
                                    path.addLine(to: fold.end)
                                }
                                .stroke(Color.blue.opacity(0.5), lineWidth: 2)
                            }
                            
                            // Current fold preview
                            if let fold = currentFold {
                                Path { path in
                                    path.move(to: fold.start)
                                    path.addLine(to: fold.end)
                                }
                                .stroke(Color.blue.opacity(0.3), style: StrokeStyle(lineWidth: 2, dash: [5]))
                            }
                        }
                        .frame(width: 400, height: 400)
                        .position(x: 600, y: 300)
                    } else {
                        // Throwing interface
                        VStack(spacing: 20) {
                            Text("Throw your apology into the night")
                                .font(.system(size: 24, weight: .thin))
                                .foregroundColor(.white.opacity(0.9))
                            
                            Text("Fold Quality: \(Int(foldQuality * 100))%")
                                .font(.system(size: 16, weight: .light))
                                .foregroundColor(.white.opacity(0.6))
                            
                            ZStack {
                                Circle()
                                    .fill(Color.white.opacity(0.1))
                                    .frame(width: 200, height: 200)
                                
                                Image(systemName: "paperplane.fill")
                                    .font(.system(size: 40))
                                    .foregroundColor(.white)
                                    .rotationEffect(.degrees(throwAngle))
                                    .scaleEffect(1.0 + throwPower * 0.5)
                                
                                if isDraggingThrow {
                                    Path { path in
                                        path.move(to: CGPoint(x: 100, y: 100))
                                        path.addLine(to: CGPoint(
                                            x: 100 + cos(throwAngle * .pi / 180) * throwPower * 80,
                                            y: 100 + sin(throwAngle * .pi / 180) * throwPower * 80
                                        ))
                                    }
                                    .stroke(Color.white.opacity(0.5), lineWidth: 2)
                                }
                            }
                            .gesture(
                                DragGesture()
                                    .onChanged { value in
                                        isDraggingThrow = true
                                        throwStart = value.startLocation
                                        let delta = CGSize(
                                            width: value.location.x - throwStart.x,
                                            height: value.location.y - throwStart.y
                                        )
                                        throwPower = min(sqrt(delta.width * delta.width + delta.height * delta.height) / 100, 1.0)
                                        throwAngle = atan2(delta.height, delta.width) * 180 / .pi
                                    }
                                    .onEnded { _ in
                                        isDraggingThrow = false
                                        throwPlane()
                                    }
                            )
                        }
                        .position(x: 600, y: 300)
                    }
                }
            }
        }
        .onAppear {
            _ = hoveredWindow
        }
    }
    
    func generateWindows() -> Void {
        windows = []
        for _ in 0..<100 {
            windows.append(DistantWindow(
                position: CGPoint(
                    x: CGFloat.random(in: 50...1150),
                    y: CGFloat.random(in: 400...700)
                )
            ))
        }
    }
    
    func calculateFoldQuality() -> Void {
        var quality = 0.0
        for fold in foldGestures {
            let length = sqrt(pow(fold.end.x - fold.start.x, 2) + pow(fold.end.y - fold.start.y, 2))
            quality += min(length / 200, 1.0) / 3.0
        }
        foldQuality = quality
    }
    
    func throwPlane() -> Void {
        let plane = PaperPlane(
            position: CGPoint(x: 600, y: 300),
            velocity: CGSize(
                width: cos(throwAngle * .pi / 180) * throwPower * 10,
                height: sin(throwAngle * .pi / 180) * throwPower * 10
            )
        )
        planes.append(plane)
        animatePlane(plane)
    }
    
    func animatePlane(_ plane: PaperPlane) -> Void {
        Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { timer in
            if let index = planes.firstIndex(where: { $0.id == plane.id }) {
                planes[index].position.x += planes[index].velocity.width
                planes[index].position.y += planes[index].velocity.height
                planes[index].velocity.height += 0.2
                planes[index].opacity -= 0.002
                
                // Check window collision
                for (windowIndex, window) in windows.enumerated() {
                    if abs(window.position.x - planes[index].position.x) < 20 &&
                       abs(window.position.y - planes[index].position.y) < 20 &&
                       !window.isIlluminated {
                        windows[windowIndex].isIlluminated = true
                    }
                }
                
                if planes[index].opacity <= 0 || planes[index].position.y > 800 {
                    planes.remove(at: index)
                    timer.invalidate()
                }
            } else {
                timer.invalidate()
            }
        }
    }
}