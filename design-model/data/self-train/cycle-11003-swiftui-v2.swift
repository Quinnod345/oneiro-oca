struct ContentView: View {
    @State private var fragments: [MemoryFragment] = []
    @State private var evidenceBags: [EvidenceBag] = []
    @State private var selectedFragment: MemoryFragment?
    @State private var accessTraces: [AccessTrace] = []
    @State private var preservationMode: Bool = false
    @State private var analysisProgress: Double = 0
    @State private var hoveredFragment: MemoryFragment?
    
    let timer = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()
    let decayTimer = Timer.publish(every: 2, on: .main, in: .common).autoconnect()
    
    private let primaryColor = Color(red: 0.2, green: 0.8, blue: 0.3)
    private let backgroundColor = Color(red: 0.05, green: 0.05, blue: 0.06)
    private let surfaceColor = Color(red: 0.08, green: 0.08, blue: 0.09)
    
    var body: some View {
        HStack(spacing: 0) {
            // Evidence Storage Panel
            VStack(alignment: .leading, spacing: 0) {
                Text("EVIDENCE STORAGE")
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundColor(primaryColor.opacity(0.6))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 20)
                
                ScrollView {
                    VStack(spacing: 16) {
                        ForEach(evidenceBags) { bag in
                            EvidenceBagView(bag: bag, primaryColor: primaryColor)
                                .onTapGesture {
                                    if !bag.sealed {
                                        withAnimation(.easeInOut(duration: 0.3)) {
                                            selectedFragment = bag.fragment
                                        }
                                    }
                                }
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
                }
            }
            .frame(width: 320)
            .background(backgroundColor)
            
            // Main Analysis Area
            ZStack {
                surfaceColor
                
                // Subtle grid
                Canvas { context, size in
                    let gridSpacing: CGFloat = 40
                    for x in stride(from: 0, to: size.width, by: gridSpacing) {
                        context.stroke(
                            Path { path in
                                path.move(to: CGPoint(x: x, y: 0))
                                path.addLine(to: CGPoint(x: x, y: size.height))
                            },
                            with: .color(.white.opacity(0.03)),
                            lineWidth: 0.5
                        )
                    }
                    for y in stride(from: 0, to: size.height, by: gridSpacing) {
                        context.stroke(
                            Path { path in
                                path.move(to: CGPoint(x: 0, y: y))
                                path.addLine(to: CGPoint(x: size.width, y: y))
                            },
                            with: .color(.white.opacity(0.03)),
                            lineWidth: 0.5
                        )
                    }
                }
                
                // Memory Fragments
                ForEach(fragments) { fragment in
                    MemoryFragmentView(
                        fragment: fragment,
                        isSelected: selectedFragment?.id == fragment.id,
                        isHovered: hoveredFragment?.id == fragment.id,
                        isPreserving: preservationMode && selectedFragment?.id == fragment.id,
                        primaryColor: primaryColor
                    )
                    .position(fragment.position)
                    .onTapGesture {
                        withAnimation(.easeOut(duration: 0.2)) {
                            selectedFragment = fragment
                            accessTraces.append(AccessTrace(
                                position: fragment.position,
                                intensity: 1.0,
                                timestamp: Date()
                            ))
                        }
                    }
                    .onHover { hovering in
                        withAnimation(.easeInOut(duration: 0.15)) {
                            hoveredFragment = hovering ? fragment : nil
                        }
                    }
                }
                
                // Access traces
                ForEach(accessTraces) { trace in
                    AccessTraceView(trace: trace, primaryColor: primaryColor)
                }
                
                // Analysis overlay for selected fragment
                if let selected = selectedFragment {
                    VStack {
                        Spacer()
                        AnalysisOverlay(fragment: selected, progress: analysisProgress, primaryColor: primaryColor)
                            .padding(24)
                    }
                }
            }
            
            // Right Panel - Tools
            VStack(spacing: 24) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("ANALYSIS TOOLS")
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                        .foregroundColor(primaryColor.opacity(0.6))
                    
                    Button(action: { 
                        withAnimation(.easeInOut(duration: 0.3)) {
                            preservationMode.toggle()
                        }
                    }) {
                        HStack {
                            Image(systemName: preservationMode ? "lock.fill" : "lock.open")
                                .font(.system(size: 14))
                            Text("PRESERVE")
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                        }
                        .foregroundColor(preservationMode ? backgroundColor : primaryColor)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(preservationMode ? primaryColor : Color.clear)
                        .overlay(
                            RoundedRectangle(cornerRadius: 4)
                                .stroke(primaryColor, lineWidth: 1)
                        )
                    }
                    .buttonStyle(PlainButtonStyle())
                    
                    Button(action: { addFragment() }) {
                        HStack {
                            Image(systemName: "plus")
                                .font(.system(size: 14))
                            Text("CAPTURE")
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                        }
                        .foregroundColor(primaryColor.opacity(0.8))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 4)
                                .stroke(primaryColor.opacity(0.4), lineWidth: 1)
                        )
                    }
                    .buttonStyle(PlainButtonStyle())
                }
                
                Spacer()
            }
            .frame(width: 200)
            .padding(24)
            .background(backgroundColor)
        }
        .background(backgroundColor)
        .onReceive(timer) { _ in
            updateAccessTraces()
            if selectedFragment != nil && analysisProgress < 1.0 {
                analysisProgress = min(1.0, analysisProgress + 0.02)
            }
        }
        .onReceive(decayTimer) { _ in
            decayFragments()
        }
        .onAppear {
            initializeFragments()
        }
    }
    
    func initializeFragments() {
        for i in 0..<5 {
            let fragment = MemoryFragment(
                content: "Memory Fragment \(i + 1)",
                timestamp: Date().addingTimeInterval(Double(i * -3600)),
                position: CGPoint(
                    x: CGFloat.random(in: 100...700),
                    y: CGFloat.random(in: 100...400)
                ),
                integrity: Double.random(in: 0.3...1.0)
            )
            fragments.append(fragment)
        }
    }
    
    func addFragment() {
        let fragment = MemoryFragment(
            content: "New Fragment \(fragments.count + 1)",
            timestamp: Date(),
            position: CGPoint(
                x: CGFloat.random(in: 100...700),
                y: CGFloat.random(in: 100...400)
            ),
            integrity: 1.0
        )
        withAnimation(.easeOut(duration: 0.3)) {
            fragments.append(fragment)
        }
    }
    
    func updateAccessTraces() {
        accessTraces = accessTraces.compactMap { trace in
            var updatedTrace = trace
            updatedTrace.intensity -= 0.05
            return updatedTrace.intensity > 0 ? updatedTrace : nil
        }
    }
    
    func decayFragments() {
        for i in fragments.indices {
            if !preservationMode || selectedFragment?.id != fragments[i].id {
                fragments[i].integrity = max(0.1, fragments[i].integrity - 0.05)
            }
        }
    }
}

struct MemoryFragment: Identifiable {
    let id = UUID()
    var content: String
    var timestamp: Date
    var position: CGPoint
    var integrity: Double
}

struct EvidenceBag: Identifiable {
    let id = UUID()
    let fragment: MemoryFragment
    let sealed: Bool
    let preservedAt: Date
}

struct AccessTrace: Identifiable {
    let id = UUID()
    var position: CGPoint
    var intensity: Double
    let timestamp: Date
}

struct MemoryFragmentView: View {
    let fragment: MemoryFragment
    let isSelected: Bool
    let isHovered: Bool
    let isPreserving: Bool
    let primaryColor: Color
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.white.opacity(0.02))
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(
                            primaryColor.opacity(isSelected ? 0.8 : isHovered ? 0.4 : 0.2),
                            lineWidth: isSelected ? 2 : 1
                        )
                )
            
            VStack(alignment: .leading, spacing: 4) {
                Text(fragment.content)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundColor(.white.opacity(fragment.integrity))
                
                HStack {
                    Circle()
                        .fill(primaryColor.opacity(fragment.integrity))
                        .frame(width: 4, height: 4)
                    Text("\(Int(fragment.integrity * 100))%")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundColor(primaryColor.opacity(0.6))
                }
            }
            .padding(12)
        }
        .frame(width: 160, height: 80)
        .scaleEffect(isSelected ? 1.05 : 1.0)
        .shadow(color: isSelected ? primaryColor.opacity(0.3) : Color.clear, radius: 10)
    }
}

struct EvidenceBagView: View {
    let bag: EvidenceBag
    let primaryColor: Color
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: bag.sealed ? "lock.fill" : "lock.open")
                    .font(.system(size: 12))
                    .foregroundColor(bag.sealed ? primaryColor : .white.opacity(0.4))
                
                Text(bag.fragment.content)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundColor(.white.opacity(0.8))
                
                Spacer()
            }
            
            Text("Preserved: \(bag.preservedAt.formatted(date: .abbreviated, time: .shortened))")
                .font(.system(size: 9, design: .monospaced))
                .foregroundColor(.white.opacity(0.4))
        }
        .padding(16)
        .background(Color.white.opacity(0.03))
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(bag.sealed ? primaryColor.opacity(0.3) : Color.white.opacity(0.1), lineWidth: 1)
        )
    }
}

struct AccessTraceView: View {
    let trace: AccessTrace
    let primaryColor: Color
    
    var body: some View {
        Circle()
            .stroke(primaryColor.opacity(trace.intensity * 0.6), lineWidth: 2)
            .frame(width: 40 * (2 - trace.intensity), height: 40 * (2 - trace.intensity))
            .position(trace.position)
            .allowsHitTesting(false)
    }
}

struct AnalysisOverlay: View {
    let fragment: MemoryFragment
    let progress: Double
    let primaryColor: Color
    
    var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("ANALYZING")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundColor(primaryColor.opacity(0.6))
                
                Text(fragment.content)
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundColor(.white.opacity(0.9))
            }
            
            Spacer()
            
            ZStack {
                Circle()
                    .stroke(primaryColor.opacity(0.2), lineWidth: 2)
                    .frame(width: 40, height: 40)
                
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(primaryColor, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .frame(width: 40, height: 40)
                    .rotationEffect(.degrees(-90))
                
                Text("\(Int(progress * 100))%")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundColor(primaryColor)
            }
        }
        .padding(20)
        .background(Color.black.opacity(0.6))
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(primaryColor.opacity(0.4), lineWidth: 1)
        )
    }
}