struct ContentView: View {
    @State private var memories: [Memory] = []
    @State private var memoryForms: [MemoryForm] = []
    @State private var currentInput: String = ""
    @State private var selectedForm: UUID?
    @State private var viewRotation: Double = 0
    @State private var viewElevation: Double = 0
    @State private var compressionLevel: Double = 0
    @State private var layerMode: Bool = false
    @State private var draggedMemory: Memory?
    @State private var voidPulsation: Double = 0
    
    let voidCenter = CGPoint(x: 720, y: 450)
    let timer = Timer.publish(every: 0.016, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            Color(red: 0.08, green: 0.08, blue: 0.08)
                .ignoresSafeArea()
            
            // Central void
            ZStack {
                ForEach(0..<5) { ring in
                    Circle()
                        .stroke(
                            Color.white.opacity(0.02 - Double(ring) * 0.002),
                            lineWidth: 1
                        )
                        .frame(
                            width: 300 + Double(ring) * 80 + sin(voidPulsation + Double(ring) * 0.3) * 10,
                            height: 300 + Double(ring) * 80 + sin(voidPulsation + Double(ring) * 0.3) * 10
                        )
                }
            }
            .position(voidCenter)
            .blur(radius: 2)
            
            // Memory forms
            ForEach(memoryForms) { form in
                MemoryFormView(
                    form: form,
                    isSelected: selectedForm == form.id,
                    viewRotation: viewRotation,
                    viewElevation: viewElevation
                )
                .position(form.position)
                .scaleEffect(form.scale)
                .rotationEffect(.degrees(form.rotation))
                .onTapGesture {
                    withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
                        selectedForm = selectedForm == form.id ? nil : form.id
                    }
                }
            }
            
            // Input area
            VStack {
                Spacer()
                HStack(spacing: 20) {
                    TextField("", text: $currentInput, prompt: Text("describe a memory...").foregroundColor(Color.white.opacity(0.3)))
                        .font(.system(size: 16, weight: .light, design: .default))
                        .foregroundColor(.white)
                        .textFieldStyle(.plain)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 14)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(Color.white.opacity(0.05))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                                )
                        )
                        .frame(maxWidth: 500)
                        .onSubmit {
                            if !currentInput.isEmpty {
                                createMemory()
                            }
                        }
                    
                    if !currentInput.isEmpty {
                        Button(action: createMemory) {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.system(size: 32))
                                .foregroundColor(Color.white.opacity(0.8))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.bottom, 40)
            }
            
            // Controls
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("ROTATION")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundColor(Color.white.opacity(0.4))
                    Slider(value: $viewRotation, in: -180...180)
                        .controlSize(.small)
                        .frame(width: 120)
                }
                
                VStack(alignment: .leading, spacing: 8) {
                    Text("ELEVATION")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundColor(Color.white.opacity(0.4))
                    Slider(value: $viewElevation, in: -45...45)
                        .controlSize(.small)
                        .frame(width: 120)
                }
                
                VStack(alignment: .leading, spacing: 8) {
                    Text("COMPRESSION")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundColor(Color.white.opacity(0.4))
                    Slider(value: $compressionLevel, in: 0...1)
                        .controlSize(.small)
                        .frame(width: 120)
                        .onChange(of: compressionLevel) { _ in
                            compressForms()
                        }
                }
                
                Toggle(isOn: $layerMode) {
                    Text("LAYER MODE")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundColor(Color.white.opacity(0.4))
                }
                .toggleStyle(.switch)
                .controlSize(.small)
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .onReceive(timer) { _ in
            voidPulsation += 0.02
            updateBreathing()
        }
    }
    
    func createMemory() {
        let colors: [Color] = [.blue, .purple, .pink, .orange, .green, .red]
        let intensity = Double.random(in: 0.3...1.0)
        
        let memory = Memory(
            text: currentInput,
            timestamp: Date(),
            intensity: intensity,
            color: colors.randomElement() ?? .blue
        )
        
        memories.append(memory)
        
        let angle = Double.random(in: 0...(2 * .pi))
        let radius = Double.random(in: 200...400)
        let position = CGPoint(
            x: voidCenter.x + cos(angle) * radius,
            y: voidCenter.y + sin(angle) * radius
        )
        
        let form = MemoryForm(
            memory: memory,
            position: position,
            scale: 0.8 + intensity * 0.4,
            rotation: Double.random(in: -45...45),
            breathPhase: Double.random(in: 0...(2 * .pi))
        )
        
        withAnimation(.spring(response: 0.8, dampingFraction: 0.6)) {
            memoryForms.append(form)
        }
        
        currentInput = ""
    }
    
    func compressForms() {
        for i in memoryForms.indices {
            let distanceFromCenter = sqrt(
                pow(memoryForms[i].position.x - voidCenter.x, 2) +
                pow(memoryForms[i].position.y - voidCenter.y, 2)
            )
            
            let targetDistance = distanceFromCenter * (1.0 - compressionLevel * 0.7)
            let angle = atan2(
                memoryForms[i].position.y - voidCenter.y,
                memoryForms[i].position.x - voidCenter.x
            )
            
            withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
                memoryForms[i].position = CGPoint(
                    x: voidCenter.x + cos(angle) * targetDistance,
                    y: voidCenter.y + sin(angle) * targetDistance
                )
                memoryForms[i].scale = (0.8 + memoryForms[i].memory.intensity * 0.4) * (1.0 - compressionLevel * 0.3)
            }
        }
    }
    
    func updateBreathing() {
        for i in memoryForms.indices {
            memoryForms[i].breathPhase += 0.02
            let breathScale = 1.0 + sin(memoryForms[i].breathPhase) * 0.05
            memoryForms[i].scale = (0.8 + memoryForms[i].memory.intensity * 0.4) * breathScale * (1.0 - compressionLevel * 0.3)
        }
    }
}