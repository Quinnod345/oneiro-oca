struct ContentView: View {
    @State private var fragments: [MemoryFragment] = []
    @State private var evidenceBags: [EvidenceBag] = []
    @State private var selectedFragment: MemoryFragment?
    @State private var lightTableFragments: [MemoryFragment] = []
    @State private var accessTraces: [AccessTrace] = []
    @State private var currentTime: Date = Date()
    @State private var preservationMode: Bool = false
    @State private var overlayOpacity: Double = 0.5
    @State private var scanlinePosition: CGFloat = 0
    
    let timer = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()
    let decayTimer = Timer.publish(every: 2, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            Color(red: 0.08, green: 0.08, blue: 0.09)
                .ignoresSafeArea()
            
            HStack(spacing: 0) {
                // Evidence Storage
                VStack(alignment: .leading, spacing: 0) {
                    Text("EVIDENCE STORAGE")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(Color(red: 0.4, green: 0.45, blue: 0.4))
                        .padding(.horizontal, 20)
                        .padding(.top, 20)
                    
                    ScrollView {
                        VStack(spacing: 12) {
                            ForEach(evidenceBags) { bag in
                                EvidenceBagView(bag: bag)
                                    .onTapGesture {
                                        if !bag.sealed {
                                            selectedFragment = bag.fragment
                                        }
                                    }
                            }
                        }
                        .padding(20)
                    }
                }
                .frame(width: 320)
                .background(Color(red: 0.06, green: 0.06, blue: 0.07))
                
                // Main Analysis Area
                ZStack {
                    // Grid overlay
                    Canvas { context, size in
                        for x in stride(from: 0, to: size.width, by: 20) {
                            context.stroke(
                                Path { path in
                                    path.move(to: CGPoint(x: x, y: 0))
                                    path.addLine(to: CGPoint(x: x, y: size.height))
                                },
                                with: .color(Color(red: 0.1, green: 0.1, blue: 0.11)),
                                lineWidth: 0.5
                            )
                        }
                        for y in stride(from: 0, to: size.height, by: 20) {
                            context.stroke(
                                Path { path in
                                    path.move(to: CGPoint(x: 0, y: y))
                                    path.addLine(to: CGPoint(x: size.width, y: y))
                                },
                                with: .color(Color(red: 0.1, green: 0.1, blue: 0.11)),
                                lineWidth: 0.5
                            )
                        }
                    }
                    
                    // Fragments
                    ForEach(fragments) { fragment in
                        MemoryFragmentView(
                            fragment: fragment,
                            isPreserving: preservationMode && selectedFragment?.id == fragment.id
                        )
                        .position(fragment.position)
                        .onTapGesture {
                            selectedFragment = fragment
                            accessTraces.append(AccessTrace(
                                position: fragment.position,
                                intensity: 1.0,
                                timestamp: Date()
                            ))
                        }
                    }
                    
                    // Access traces
                    ForEach(accessTraces) { trace in
                        AccessTraceView(trace: trace)
                    }
                    
                    // Scanline effect
                    Rectangle()
                        .fill(LinearGradient(
                            colors: [
                                Color(red: 0.2, green: 0.8, blue: 0.3).opacity(0),
                                Color(red: 0.2, green: 0.8, blue: 0.3).opacity(0.1),
                                Color(red: 0.2, green: 0.8, blue: 0.3).opacity(0)
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        ))
                        .frame(height: 2)
                        .offset(y: scanlinePosition - 450)
                        .animation(.linear(duration: 4).repeatForever(autoreverses: false), value: scanlinePosition)
                }
                .frame(width: 800)
                .clipShape(Rectangle())
                
                // Light Table
                VStack(spacing: 0) {
                    Text("LIGHT TABLE")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(Color(red: 0.4, green: 0.45, blue: 0.4))
                        .padding(.top, 20)
                    
                    ZStack {
                        // Backlight
                        Rectangle()
                            .fill(Color(red: 0.95, green: 0.95, blue: 0.92))
                            .blur(radius: 20)
                        
                        // Overlaid fragments
                        ForEach(lightTableFragments) { fragment in
                            LightTableFragmentView(
                                fragment: fragment,
                                opacity: overlayOpacity
                            )
                        }
                    }
                    .frame(maxHeight: .infinity)
                    .background(Color(red: 0.08, green: 0.08, blue: 0.07))
                }
                .frame(width: 280)
            }
        }
        .onAppear {
            scanlinePosition = 900
            generateFragments()
        }
        .onReceive(timer) { _ in
            currentTime = Date()
        }
        .onReceive(decayTimer) { _ in
            decayFragments()
        }
    }
    
    func generateFragments() {
        for _ in 0..<8 {
            fragments.append(MemoryFragment(
                position: CGPoint(
                    x: CGFloat.random(in: 100...700),
                    y: CGFloat.random(in: 100...500)
                ),
                content: ["WITNESS_037", "INCIDENT_2019", "TRACE_EVIDENCE", "CORRUPTED", "REDACTED"].randomElement()!,
                decay: Double.random(in: 0.3...1.0),
                isCorrupted: Bool.random()
            ))
        }
    }
    
    func decayFragments() {
        for i in fragments.indices {
            fragments[i].decay = max(0, fragments[i].decay - 0.05)
            if Double.random(in: 0...1) < 0.1 {
                fragments[i].isCorrupted = true
            }
        }
        
        accessTraces = accessTraces.filter { trace in
            Date().timeIntervalSince(trace.timestamp) < 3
        }
    }
}

struct EvidenceBagView: View {
    let bag: EvidenceBag
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Circle()
                    .fill(bag.sealed ? Color.red : Color.green)
                    .frame(width: 6, height: 6)
                Text(bag.sealed ? "SEALED" : "ACTIVE")
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .foregroundColor(bag.sealed ? Color.red : Color.green)
            }
            
            Text(bag.fragment.content)
                .font(.system(size: 12, weight: .regular, design: .monospaced))
                .foregroundColor(Color.gray)
            
            Text(bag.timestamp, style: .time)
                .font(.system(size: 10, weight: .regular, design: .monospaced))
                .foregroundColor(Color(red: 0.4, green: 0.4, blue: 0.42))
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(red: 0.08, green: 0.08, blue: 0.09))
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(Color(red: 0.2, green: 0.2, blue: 0.22), lineWidth: 1)
        )
    }
}

struct MemoryFragmentView: View {
    let fragment: MemoryFragment
    let isPreserving: Bool
    
    var body: some View {
        ZStack {
            if fragment.isCorrupted {
                ForEach(0..<3) { i in
                    Text(fragment.content)
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(Color.red.opacity(0.3))
                        .blur(radius: 2)
                        .offset(x: CGFloat(i - 1) * 2, y: CGFloat(i - 1) * 2)
                }
            }
            
            Text(fragment.content)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundColor(Color(red: 0.2, green: 0.8, blue: 0.3).opacity(fragment.decay))
                .shadow(color: Color(red: 0.2, green: 0.8, blue: 0.3), radius: 4)
            
            if isPreserving {
                Circle()
                    .stroke(Color.orange, lineWidth: 2)
                    .frame(width: 80, height: 80)
                    .scaleEffect(1.5)
                    .opacity(0.5)
                    .animation(.easeInOut(duration: 1).repeatForever(), value: isPreserving)
            }
        }
    }
}

struct AccessTraceView: View {
    let trace: AccessTrace
    @State private var opacity: Double = 1.0
    
    var body: some View {
        Circle()
            .stroke(Color(red: 0.2, green: 0.8, blue: 0.3), lineWidth: 2)
            .frame(width: 40, height: 40)
            .scaleEffect(3 - opacity * 2)
            .opacity(opacity)
            .position(trace.position)
            .onAppear {
                withAnimation(.easeOut(duration: 3)) {
                    opacity = 0
                }
            }
    }
}

struct LightTableFragmentView: View {
    let fragment: MemoryFragment
    let opacity: Double
    
    var body: some View {
        Text(fragment.content)
            .font(.system(size: 14, weight: .regular, design: .monospaced))
            .foregroundColor(Color.black.opacity(opacity))
            .padding(8)
            .background(Color.white.opacity(0.1))
            .overlay(
                Rectangle()
                    .stroke(Color.black.opacity(0.2), lineWidth: 1)
            )
            .rotationEffect(.degrees(Double.random(in: -5...5)))
            .offset(
                x: CGFloat.random(in: -30...30),
                y: CGFloat.random(in: -30...30)
            )
    }
}