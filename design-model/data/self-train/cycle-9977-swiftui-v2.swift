struct ContentView: View {
    @State private var memories: [Memory] = []
    @State private var currentInput: String = ""
    @State private var selectedMemoryID: UUID?
    @State private var viewRotation: Double = 0
    @State private var memoryDepth: Double = 1.0
    @State private var pulsePhase: Double = 0
    
    let timer = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()
            
            // Memory constellation
            GeometryReader { geometry in
                ForEach(memories) { memory in
                    MemoryNode(
                        memory: memory,
                        isSelected: selectedMemoryID == memory.id,
                        depth: memoryDepth,
                        pulsePhase: pulsePhase
                    )
                    .position(
                        x: memory.position.x * geometry.size.width,
                        y: memory.position.y * geometry.size.height
                    )
                    .rotationEffect(.degrees(viewRotation * memory.depth))
                    .scaleEffect(0.5 + memory.depth * 0.5 * memoryDepth)
                    .onTapGesture {
                        withAnimation(.easeInOut(duration: 0.3)) {
                            selectedMemoryID = selectedMemoryID == memory.id ? nil : memory.id
                        }
                    }
                }
            }
            .blur(radius: selectedMemoryID != nil ? 2 : 0)
            
            // Selected memory detail
            if let selected = memories.first(where: { $0.id == selectedMemoryID }) {
                MemoryDetail(memory: selected, onDismiss: {
                    withAnimation(.easeInOut(duration: 0.3)) {
                        selectedMemoryID = nil
                    }
                })
                .transition(.opacity.combined(with: .scale(scale: 0.9)))
            }
            
            // Input interface
            VStack {
                Spacer()
                
                HStack(spacing: 0) {
                    TextField("", text: $currentInput, prompt: Text("Enter memory").foregroundColor(.white.opacity(0.5)))
                        .font(.system(size: 18, weight: .light))
                        .foregroundColor(.white)
                        .textFieldStyle(.plain)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 16)
                        .background(
                            Capsule()
                                .fill(.white.opacity(0.08))
                                .overlay(
                                    Capsule()
                                        .strokeBorder(.white.opacity(0.2), lineWidth: 1)
                                )
                        )
                        .onSubmit {
                            createMemory()
                        }
                    
                    if !currentInput.isEmpty {
                        Button(action: createMemory) {
                            Image(systemName: "plus.circle.fill")
                                .font(.system(size: 28))
                                .foregroundColor(.white)
                                .padding(.leading, 12)
                        }
                        .buttonStyle(.plain)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                    }
                }
                .frame(maxWidth: 500)
                .padding(.horizontal, 40)
                .padding(.bottom, 40)
            }
            
            // Minimal controls
            VStack {
                HStack(spacing: 32) {
                    ControlKnob(value: $viewRotation, range: -30...30, label: "Rotate")
                    ControlKnob(value: $memoryDepth, range: 0.5...1.5, label: "Depth")
                }
                .padding(24)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(.white.opacity(0.05))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16)
                                .strokeBorder(.white.opacity(0.1), lineWidth: 1)
                        )
                )
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            .padding(32)
        }
        .onReceive(timer) { _ in
            pulsePhase += 0.1
        }
    }
    
    func createMemory() {
        guard !currentInput.isEmpty else { return }
        
        let newMemory = Memory(
            content: currentInput,
            position: CGPoint(
                x: Double.random(in: 0.2...0.8),
                y: Double.random(in: 0.2...0.8)
            ),
            depth: Double.random(in: 0.3...1.0)
        )
        
        withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
            memories.append(newMemory)
            currentInput = ""
        }
    }
}

struct Memory: Identifiable {
    let id = UUID()
    let content: String
    let position: CGPoint
    let depth: Double
    let timestamp = Date()
}

struct MemoryNode: View {
    let memory: Memory
    let isSelected: Bool
    let depth: Double
    let pulsePhase: Double
    
    var opacity: Double {
        0.4 + memory.depth * 0.4
    }
    
    var body: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        gradient: Gradient(colors: [
                            .white.opacity(opacity),
                            .white.opacity(opacity * 0.3)
                        ]),
                        center: .center,
                        startRadius: 0,
                        endRadius: 20
                    )
                )
                .frame(width: 40, height: 40)
                .scaleEffect(1 + sin(pulsePhase + memory.depth * 2) * 0.05)
            
            if isSelected {
                Circle()
                    .stroke(.white.opacity(0.8), lineWidth: 2)
                    .frame(width: 50, height: 50)
            }
        }
    }
}

struct MemoryDetail: View {
    let memory: Memory
    let onDismiss: () -> Void
    
    var body: some View {
        VStack(spacing: 24) {
            Text(memory.content)
                .font(.system(size: 24, weight: .light))
                .foregroundColor(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            
            Text(memory.timestamp, style: .relative)
                .font(.system(size: 14))
                .foregroundColor(.white.opacity(0.5))
            
            Button(action: onDismiss) {
                Text("Close")
                    .font(.system(size: 16))
                    .foregroundColor(.white.opacity(0.8))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 8)
                    .background(
                        Capsule()
                            .strokeBorder(.white.opacity(0.3), lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
        }
        .padding(48)
        .background(
            RoundedRectangle(cornerRadius: 20)
                .fill(.black.opacity(0.8))
                .background(
                    RoundedRectangle(cornerRadius: 20)
                        .fill(.ultraThinMaterial)
                )
        )
        .frame(maxWidth: 400)
    }
}

struct ControlKnob: View {
    @Binding var value: Double
    let range: ClosedRange<Double>
    let label: String
    
    var normalizedValue: Double {
        (value - range.lowerBound) / (range.upperBound - range.lowerBound)
    }
    
    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                Circle()
                    .fill(.white.opacity(0.05))
                    .frame(width: 44, height: 44)
                
                Circle()
                    .trim(from: 0, to: normalizedValue)
                    .stroke(.white.opacity(0.8), lineWidth: 2)
                    .frame(width: 40, height: 40)
                    .rotationEffect(.degrees(-90))
                
                Circle()
                    .fill(.white)
                    .frame(width: 8, height: 8)
            }
            .gesture(
                DragGesture()
                    .onChanged { value in
                        let delta = value.translation.width / 100
                        let newValue = self.value + delta * (range.upperBound - range.lowerBound)
                        self.value = min(max(newValue, range.lowerBound), range.upperBound)
                    }
            )
            
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(.white.opacity(0.6))
        }
    }
}