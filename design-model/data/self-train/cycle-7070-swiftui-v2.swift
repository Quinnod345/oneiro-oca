struct ContentView: View {
    @State private var fragments: [DreamFragment] = []
    @State private var currentInput: String = ""
    @State private var draggedFragment: DreamFragment?
    @State private var dragOffset: CGSize = .zero
    @State private var showingInput: Bool = false
    @State private var inputPosition: CGPoint = CGPoint(x: UIScreen.main.bounds.width/2, y: UIScreen.main.bounds.height/2)
    
    let watercolorPalette: [Color] = [
        Color(red: 0.47, green: 0.56, blue: 0.61).opacity(0.6),  // Payne's gray
        Color(red: 0.84, green: 0.71, blue: 0.67).opacity(0.5),  // Raw umber
        Color(red: 0.62, green: 0.71, blue: 0.80).opacity(0.4),  // Cerulean
        Color(red: 0.80, green: 0.73, blue: 0.82).opacity(0.5)   // Lavender
    ]
    
    var body: some View {
        ZStack {
            // Watercolor paper texture
            Color(red: 0.98, green: 0.97, blue: 0.95)
                .overlay(
                    Canvas { context, size in
                        for _ in 0..<30 {
                            let x = CGFloat.random(in: 0...size.width)
                            let y = CGFloat.random(in: 0...size.height)
                            let color = watercolorPalette.randomElement()!
                            
                            context.fill(
                                Circle().path(in: CGRect(x: x, y: y, width: 120, height: 120)),
                                with: .color(color.opacity(0.03))
                            )
                        }
                    }
                )
            
            // Dream fragments
            ForEach(fragments) { fragment in
                WatercolorDream(
                    fragment: fragment,
                    isDragging: draggedFragment?.id == fragment.id
                )
                .offset(draggedFragment?.id == fragment.id ? dragOffset : .zero)
                .onTapGesture {
                    if showingInput {
                        withAnimation(.easeOut(duration: 0.3)) {
                            showingInput = false
                        }
                    }
                }
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            if draggedFragment?.id == fragment.id {
                                dragOffset = value.translation
                            } else {
                                draggedFragment = fragment
                                dragOffset = value.translation
                            }
                        }
                        .onEnded { value in
                            if let index = fragments.firstIndex(where: { $0.id == fragment.id }) {
                                withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                                    fragments[index].position.x += value.translation.width
                                    fragments[index].position.y += value.translation.height
                                }
                            }
                            draggedFragment = nil
                            dragOffset = .zero
                        }
                )
            }
            
            // Floating input
            if showingInput {
                FloatingDreamInput(
                    text: $currentInput,
                    position: $inputPosition,
                    onSubmit: {
                        addDreamFragment()
                        withAnimation(.easeOut(duration: 0.3)) {
                            showingInput = false
                        }
                    },
                    onCancel: {
                        withAnimation(.easeOut(duration: 0.3)) {
                            showingInput = false
                            currentInput = ""
                        }
                    }
                )
            }
            
            // Add button
            VStack {
                Spacer()
                HStack {
                    Spacer()
                    Button(action: {
                        withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                            showingInput = true
                            inputPosition = CGPoint(
                                x: CGFloat.random(in: 100...UIScreen.main.bounds.width-100),
                                y: CGFloat.random(in: 200...UIScreen.main.bounds.height-200)
                            )
                        }
                    }) {
                        Circle()
                            .fill(watercolorPalette[0].opacity(0.1))
                            .frame(width: 56, height: 56)
                            .overlay(
                                Image(systemName: "plus")
                                    .font(.system(size: 24, weight: .light))
                                    .foregroundColor(watercolorPalette[0])
                            )
                    }
                    .padding(.trailing, 30)
                    .padding(.bottom, 30)
                }
            }
        }
        .onAppear {
            startAgingTimer()
        }
    }
    
    func addDreamFragment() {
        guard !currentInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        
        let fragment = DreamFragment(
            text: currentInput,
            position: inputPosition,
            color: watercolorPalette.randomElement()!,
            creationTime: Date()
        )
        
        withAnimation(.easeOut(duration: 0.8)) {
            fragments.append(fragment)
        }
        
        currentInput = ""
    }
    
    func startAgingTimer() {
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            withAnimation(.easeInOut(duration: 2.0)) {
                for index in fragments.indices {
                    let age = Date().timeIntervalSince(fragments[index].creationTime)
                    if age > 30 && !fragments[index].isPinned {
                        fragments[index].opacity = max(0.1, 1.0 - (age - 30) / 120)
                    }
                }
            }
            fragments.removeAll { $0.opacity <= 0.1 && !$0.isPinned }
        }
    }
}

struct WatercolorDream: View {
    let fragment: DreamFragment
    let isDragging: Bool
    @State private var phase: CGFloat = 0
    
    var body: some View {
        Text(fragment.text)
            .font(.system(size: 16, weight: .light, design: .serif))
            .foregroundColor(Color.black.opacity(0.7))
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(
                ZStack {
                    ForEach(0..<3) { i in
                        fragment.color
                            .opacity(0.2)
                            .blur(radius: 12)
                            .scaleEffect(1.0 + sin(phase + Double(i)) * 0.1)
                            .offset(
                                x: cos(phase + Double(i) * 2) * 5,
                                y: sin(phase + Double(i) * 2) * 5
                            )
                    }
                }
            )
            .clipShape(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
            )
            .opacity(fragment.opacity)
            .scaleEffect(isDragging ? 1.05 : 1.0)
            .shadow(color: fragment.color.opacity(isDragging ? 0.3 : 0.1), radius: isDragging ? 15 : 8, y: isDragging ? 8 : 4)
            .position(fragment.position)
            .onAppear {
                withAnimation(.easeInOut(duration: 8).repeatForever(autoreverses: false)) {
                    phase = .pi * 2
                }
            }
    }
}

struct FloatingDreamInput: View {
    @Binding var text: String
    @Binding var position: CGPoint
    let onSubmit: () -> Void
    let onCancel: () -> Void
    @State private var dragOffset: CGSize = .zero
    @FocusState private var isFocused: Bool
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("dream")
                    .font(.system(size: 14, weight: .light, design: .serif))
                    .foregroundColor(Color.black.opacity(0.4))
                Spacer()
                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .light))
                        .foregroundColor(Color.black.opacity(0.4))
                }
            }
            
            TextField("", text: $text)
                .textFieldStyle(.plain)
                .font(.system(size: 16, weight: .light, design: .serif))
                .foregroundColor(Color.black.opacity(0.8))
                .focused($isFocused)
                .onSubmit(onSubmit)
        }
        .padding(20)
        .frame(width: 280)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.white.opacity(0.9))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.black.opacity(0.05), lineWidth: 1)
                )
        )
        .shadow(color: Color.black.opacity(0.1), radius: 20, y: 10)
        .position(position)
        .offset(dragOffset)
        .gesture(
            DragGesture()
                .onChanged { value in
                    dragOffset = value.translation
                }
                .onEnded { value in
                    withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                        position.x += value.translation.width
                        position.y += value.translation.height
                        dragOffset = .zero
                    }
                }
        )
        .onAppear {
            isFocused = true
        }
    }
}