struct ContentView: View {
    @State private var uploadedText: String = ""
    @State private var fragments: [MemoryFragment] = []
    @State private var pathways: [NeuralPathway] = []
    @State private var decayTimer: Timer?
    @State private var currentDecayLevel: Double = 0.0
    @State private var isDecaying: Bool = false
    @State private var reconstructionMode: Bool = false
    @State private var reconstructedText: String = ""
    @State private var selectedFragment: UUID?
    @State private var draggedFragment: MemoryFragment?
    @State private var glitchOffset: CGSize = .zero
    
    let disorderTypes = ["Alzheimer's", "Amnesia", "Dementia", "Aphasia"]
    @State private var selectedDisorder: String = "Alzheimer's"
    
    let baseUnit: CGFloat = 8
    let primaryColor = Color(red: 0.95, green: 0.87, blue: 0.73)
    let secondaryColor = Color(red: 0.67, green: 0.84, blue: 0.90)
    let warningColor = Color(red: 0.98, green: 0.65, blue: 0.42)
    let backgroundColor = Color(red: 0.05, green: 0.05, blue: 0.08)
    
    var body: some View {
        ZStack {
            backgroundColor
                .ignoresSafeArea()
            
            Canvas { context, size in
                for pathway in pathways {
                    var path = Path()
                    path.move(to: pathway.startPoint)
                    
                    let control1 = CGPoint(
                        x: pathway.startPoint.x + (pathway.endPoint.x - pathway.startPoint.x) * 0.3,
                        y: pathway.startPoint.y + 50
                    )
                    let control2 = CGPoint(
                        x: pathway.endPoint.x - (pathway.endPoint.x - pathway.startPoint.x) * 0.3,
                        y: pathway.endPoint.y - 50
                    )
                    
                    path.addCurve(to: pathway.endPoint, control1: control1, control2: control2)
                    
                    let strokeColor = pathway.isBreaking ? warningColor : secondaryColor
                    context.stroke(path, with: .color(strokeColor.opacity(pathway.opacity * 0.3)),
                                 lineWidth: pathway.thickness)
                }
            }
            .blur(radius: 1)
            
            if !isDecaying && !reconstructionMode {
                VStack(spacing: baseUnit * 6) {
                    Text("Memory Decay Simulator")
                        .font(.system(size: 32, weight: .light, design: .default))
                        .foregroundColor(primaryColor)
                        .padding(.top, baseUnit * 8)
                    
                    VStack(spacing: baseUnit * 3) {
                        Text("Enter a memory to decay")
                            .font(.system(size: 18, weight: .regular))
                            .foregroundColor(primaryColor.opacity(0.8))
                        
                        TextEditor(text: $uploadedText)
                            .font(.system(size: 16, weight: .regular))
                            .foregroundColor(primaryColor)
                            .scrollContentBackground(.hidden)
                            .background(primaryColor.opacity(0.05))
                            .frame(maxWidth: 600, minHeight: 200, maxHeight: 200)
                            .cornerRadius(baseUnit)
                            .overlay(
                                RoundedRectangle(cornerRadius: baseUnit)
                                    .stroke(primaryColor.opacity(0.2), lineWidth: 1)
                            )
                        
                        HStack(spacing: baseUnit * 2) {
                            ForEach(disorderTypes, id: \.self) { disorder in
                                Button(action: { selectedDisorder = disorder }) {
                                    Text(disorder)
                                        .font(.system(size: 14, weight: .medium))
                                        .foregroundColor(selectedDisorder == disorder ? backgroundColor : primaryColor.opacity(0.8))
                                        .padding(.horizontal, baseUnit * 3)
                                        .padding(.vertical, baseUnit * 1.5)
                                        .background(
                                            RoundedRectangle(cornerRadius: baseUnit * 0.75)
                                                .fill(selectedDisorder == disorder ? primaryColor : Color.clear)
                                        )
                                        .overlay(
                                            RoundedRectangle(cornerRadius: baseUnit * 0.75)
                                                .stroke(primaryColor.opacity(0.3), lineWidth: 1)
                                        )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.top, baseUnit)
                        
                        Button(action: startDecay) {
                            Text("Begin Decay")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(backgroundColor)
                                .padding(.horizontal, baseUnit * 5)
                                .padding(.vertical, baseUnit * 2)
                                .background(primaryColor)
                                .cornerRadius(baseUnit)
                                .shadow(color: primaryColor.opacity(0.3), radius: baseUnit * 2)
                        }
                        .buttonStyle(.plain)
                        .padding(.top, baseUnit * 2)
                    }
                    
                    Spacer()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if isDecaying {
                VStack(spacing: baseUnit * 5) {
                    HStack(spacing: baseUnit * 4) {
                        VStack(alignment: .leading, spacing: baseUnit) {
                            Text("DECAY LEVEL")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(secondaryColor.opacity(0.6))
                            Text("\(Int(currentDecayLevel * 100))%")
                                .font(.system(size: 36, weight: .light))
                                .foregroundColor(warningColor.opacity(0.8 + currentDecayLevel * 0.2))
                        }
                        
                        VStack(alignment: .leading, spacing: baseUnit) {
                            Text("DISORDER")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(secondaryColor.opacity(0.6))
                            Text(selectedDisorder.uppercased())
                                .font(.system(size: 24, weight: .light))
                                .foregroundColor(primaryColor)
                        }
                    }
                    .padding(.top, baseUnit * 6)
                    
                    ZStack {
                        ForEach(fragments) { fragment in
                            MemoryFragmentView(
                                fragment: fragment,
                                isSelected: selectedFragment == fragment.id,
                                primaryColor: primaryColor,
                                warningColor: warningColor,
                                baseUnit: baseUnit
                            )
                            .scaleEffect(fragment.decay > 0.8 ? 0.8 : 1.0)
                            .opacity(1.0 - fragment.decay * 0.3)
                            .offset(fragment.offset)
                            .offset(x: fragment.drift.width, y: fragment.drift.height)
                            .rotationEffect(Angle(degrees: fragment.rotation))
                            .onTapGesture {
                                selectedFragment = selectedFragment == fragment.id ? nil : fragment.id
                            }
                            .onDrag {
                                NSItemProvider(object: fragment.id.uuidString as NSString)
                            }
                            .animation(.spring(response: 0.5, dampingFraction: 0.8), value: fragment.offset)
                            .animation(.easeInOut(duration: 2.0), value: fragment.drift)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    
                    if currentDecayLevel > 0.9 {
                        Button(action: startReconstruction) {
                            Text("Attempt Reconstruction")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(backgroundColor)
                                .padding(.horizontal, baseUnit * 4)
                                .padding(.vertical, baseUnit * 2)
                                .background(secondaryColor)
                                .cornerRadius(baseUnit)
                                .shadow(color: secondaryColor.opacity(0.3), radius: baseUnit * 2)
                        }
                        .buttonStyle(.plain)
                        .padding(.bottom, baseUnit * 6)
                        .transition(.opacity)
                    }
                }
            } else if reconstructionMode {
                VStack(spacing: baseUnit * 5) {
                    Text("Memory Reconstruction")
                        .font(.system(size: 28, weight: .light))
                        .foregroundColor(secondaryColor)
                        .padding(.top, baseUnit * 6)
                    
                    ScrollView {
                        VStack(alignment: .leading, spacing: baseUnit * 3) {
                            ForEach(fragments.sorted(by: { $0.orderIndex < $1.orderIndex })) { fragment in
                                if fragment.decay < 0.95 {
                                    Text(fragment.text)
                                        .font(.system(size: 18, weight: .regular))
                                        .foregroundColor(primaryColor.opacity(1.0 - fragment.decay))
                                        .padding(baseUnit * 2)
                                        .background(
                                            RoundedRectangle(cornerRadius: baseUnit * 0.5)
                                                .fill(secondaryColor.opacity(0.1))
                                        )
                                        .overlay(
                                            RoundedRectangle(cornerRadius: baseUnit * 0.5)
                                                .stroke(secondaryColor.opacity(0.2), lineWidth: 1)
                                        )
                                        .draggable(fragment.id.uuidString)
                                }
                            }
                        }
                        .padding(.horizontal, baseUnit * 4)
                    }
                    .frame(maxWidth: 800, maxHeight: 400)
                    
                    VStack(spacing: baseUnit * 2) {
                        Text("Reconstructed Memory")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(secondaryColor.opacity(0.8))
                        
                        Text(reconstructedText.isEmpty ? "Drag fragments to reconstruct..." : reconstructedText)
                            .font(.system(size: 16, weight: .regular))
                            .foregroundColor(primaryColor.opacity(0.8))
                            .padding(baseUnit * 3)
                            .frame(maxWidth: 600, minHeight: 100)
                            .background(primaryColor.opacity(0.05))
                            .cornerRadius(baseUnit)
                            .overlay(
                                RoundedRectangle(cornerRadius: baseUnit)
                                    .stroke(primaryColor.opacity(0.2), lineWidth: 1)
                            )
                    }
                    
                    HStack(spacing: baseUnit * 3) {
                        Button(action: {
                            reconstructedText = ""
                            reconstructionMode = false
                            isDecaying = false
                            fragments.removeAll()
                            pathways.removeAll()
                            currentDecayLevel = 0.0
                        }) {
                            Text("New Memory")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(primaryColor)
                                .padding(.horizontal, baseUnit * 3)
                                .padding(.vertical, baseUnit * 1.5)
                                .overlay(
                                    RoundedRectangle(cornerRadius: baseUnit * 0.75)
                                        .stroke(primaryColor.opacity(0.3), lineWidth: 1)
                                )
                        }
                        .buttonStyle(.plain)
                        
                        Button(action: compareMemories) {
                            Text("Compare Original")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(backgroundColor)
                                .padding(.horizontal, baseUnit * 3)
                                .padding(.vertical, baseUnit * 1.5)
                                .background(secondaryColor)
                                .cornerRadius(baseUnit * 0.75)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.bottom, baseUnit * 6)
                }
            }
        }
        .onReceive(Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()) { _ in
            if isDecaying && currentDecayLevel < 1.0 {
                updateDecay()
                updatePathways()
            }
        }
    }
    
    func startDecay() {
        guard !uploadedText.isEmpty else { return }
        isDecaying = true
        createFragments()
        createNeuralPathways()
    }
    
    func createFragments() {
        let words = uploadedText.split(separator: " ")
        fragments = []
        
        for (index, word) in words.enumerated() {
            let fragment = MemoryFragment(
                text: String(word),
                originalPosition: CGPoint(x: CGFloat.random(in: 100...700), y: CGFloat.random(in: 100...500)),
                orderIndex: index
            )
            fragments.append(fragment)
        }
    }
    
    func createNeuralPathways() {
        pathways = []
        for i in 0..<20 {
            let pathway = NeuralPathway(
                startPoint: CGPoint(x: CGFloat.random(in: 0...900), y: CGFloat.random(in: 0...700)),
                endPoint: CGPoint(x: CGFloat.random(in: 0...900), y: CGFloat.random(in: 0...700)),
                thickness: CGFloat.random(in: 0.5...2.0)
            )
            pathways.append(pathway)
        }
    }
    
    func updateDecay() {
        currentDecayLevel += getDecayRate()
        
        for i in fragments.indices {
            fragments[i].decay = min(1.0, fragments[i].decay + getDecayRate() * CGFloat.random(in: 0.5...1.5))
            fragments[i].drift = CGSize(
                width: CGFloat.random(in: -20...20) * fragments[i].decay,
                height: CGFloat.random(in: -20...20) * fragments[i].decay
            )
            fragments[i].rotation = Double.random(in: -5...5) * fragments[i].decay
        }
    }
    
    func updatePathways() {
        for i in pathways.indices {
            pathways[i].opacity = max(0, pathways[i].opacity - 0.01)
            if currentDecayLevel > 0.5 && Bool.random() {
                pathways[i].isBreaking = true
            }
        }
    }
    
    func getDecayRate() -> Double {
        switch selectedDisorder {
        case "Alzheimer's": return 0.008
        case "Amnesia": return 0.015
        case "Dementia": return 0.010
        case "Aphasia": return 0.012
        default: return 0.010
        }
    }
    
    func startReconstruction() {
        reconstructionMode = true
        isDecaying = false
    }
    
    func compareMemories() {
        // Implementation for memory comparison
    }
}

struct MemoryFragment: Identifiable {
    let id = UUID()
    var text: String
    var originalPosition: CGPoint
    var offset: CGSize = .zero
    var drift: CGSize = .zero
    var rotation: Double = 0
    var decay: Double = 0
    var orderIndex: Int
}

struct NeuralPathway: Identifiable {
    let id = UUID()
    var startPoint: CGPoint
    var endPoint: CGPoint
    var opacity: Double = 1.0
    var thickness: CGFloat
    var isBreaking: Bool = false
}

struct MemoryFragmentView: View {
    let fragment: MemoryFragment
    let isSelected: Bool
    let primaryColor: Color
    let warningColor: Color
    let baseUnit: CGFloat
    
    var body: some View {
        Text(fragment.text)
            .font(.system(size: 16, weight: .regular))
            .foregroundColor(primaryColor.opacity(1.0 - fragment.decay * 0.5))
            .padding(.horizontal, baseUnit * 2)
            .padding(.vertical, baseUnit)
            .background(
                RoundedRectangle(cornerRadius: baseUnit * 0.5)
                    .fill(primaryColor.opacity(0.05 + (isSelected ? 0.1 : 0)))
            )
            .overlay(
                RoundedRectangle(cornerRadius: baseUnit * 0.5)
                    .stroke(isSelected ? warningColor : primaryColor.opacity(0.2), lineWidth: isSelected ? 2 : 1)
            )
            .shadow(color: primaryColor.opacity(0.1), radius: baseUnit, x: 0, y: baseUnit * 0.5)
    }
}