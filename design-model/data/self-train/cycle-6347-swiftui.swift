struct ContentView: View {
    @State private var entries: [MemoryEntry] = []
    @State private var selectedEntry: MemoryEntry?
    @State private var isAddingMemory = false
    @State private var newMemoryText = ""
    @State private var hoveredEntry: MemoryEntry?
    
    let timer = Timer.publish(every: 60, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            
            // Background emotional residue
            ForEach(entries.filter { $0.decayLevel > 0.7 }) { entry in
                EmotionalCloudView(entry: entry)
                    .allowsHitTesting(false)
            }
            
            ScrollView {
                LazyVGrid(columns: [
                    GridItem(.adaptive(minimum: 200, maximum: 300), spacing: 20)
                ], spacing: 20) {
                    ForEach(entries) { entry in
                        MemoryCard(
                            entry: entry,
                            isHovered: hoveredEntry?.id == entry.id
                        )
                        .onHover { hovering in
                            withAnimation(.easeInOut(duration: 0.3)) {
                                hoveredEntry = hovering ? entry : nil
                            }
                        }
                        .onTapGesture {
                            selectedEntry = entry
                        }
                    }
                }
                .padding(40)
            }
            
            VStack {
                HStack {
                    Spacer()
                    Button(action: { isAddingMemory = true }) {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 32))
                            .foregroundColor(.white.opacity(0.3))
                            .background(
                                Circle()
                                    .fill(Color.white.opacity(0.05))
                                    .frame(width: 60, height: 60)
                            )
                    }
                    .buttonStyle(PlainButtonStyle())
                    .padding(40)
                }
                Spacer()
            }
            
            if isAddingMemory {
                AddMemoryView(
                    text: $newMemoryText,
                    isPresented: $isAddingMemory,
                    onSave: {
                        let entry = MemoryEntry(
                            text: newMemoryText,
                            timestamp: Date(),
                            emotionalColor: Color(
                                red: Double.random(in: 0.3...1.0),
                                green: Double.random(in: 0.3...1.0),
                                blue: Double.random(in: 0.3...1.0)
                            )
                        )
                        entries.insert(entry, at: 0)
                        newMemoryText = ""
                    }
                )
            }
        }
        .frame(width: 1440, height: 900)
        .onReceive(timer) { _ in
            entries = entries.map { $0.aged() }
        }
    }
}

struct MemoryEntry: Identifiable {
    let id = UUID()
    let text: String
    let timestamp: Date
    let emotionalColor: Color
    var decayLevel: Double = 0.0
    
    func aged() -> MemoryEntry {
        var aged = self
        let daysSince = Date().timeIntervalSince(timestamp) / 86400
        aged.decayLevel = min(1.0, daysSince / 365)
        return aged
    }
    
    var opacity: Double {
        max(0.1, 1.0 - decayLevel)
    }
    
    var blur: Double {
        decayLevel * 20
    }
    
    var distortedText: String {
        guard decayLevel > 0.3 else { return text }
        
        let words = text.split(separator: " ")
        let distortionLevel = Int(decayLevel * Double(words.count))
        
        var distorted = words.map(String.init)
        for _ in 0..<distortionLevel {
            let index = Int.random(in: 0..<distorted.count)
            if decayLevel > 0.7 {
                distorted[index] = String(repeating: "░", count: distorted[index].count)
            } else if decayLevel > 0.5 {
                let chars = Array(distorted[index])
                let corrupted = chars.enumerated().map { i, char in
                    i % 2 == 0 ? char : "▓"
                }
                distorted[index] = String(corrupted)
            }
        }
        
        return distorted.joined(separator: " ")
    }
}

struct MemoryCard: View {
    let entry: MemoryEntry
    let isHovered: Bool
    
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(entry.emotionalColor.opacity(entry.opacity * 0.1))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(entry.emotionalColor.opacity(entry.opacity * 0.3), lineWidth: 1)
                )
            
            VStack(alignment: .leading, spacing: 8) {
                Text(entry.timestamp, style: .date)
                    .font(.caption)
                    .foregroundColor(.gray.opacity(entry.opacity))
                    .blur(radius: entry.blur * 0.3)
                
                Text(isHovered && entry.decayLevel > 0.5 ? entry.text : entry.distortedText)
                    .font(.system(size: 14, weight: .regular, design: .serif))
                    .foregroundColor(.white.opacity(entry.opacity))
                    .blur(radius: isHovered ? 0 : entry.blur)
                    .animation(.easeInOut(duration: 0.5), value: isHovered)
                    .lineLimit(6)
                    .multilineTextAlignment(.leading)
            }
            .padding(16)
        }
        .frame(height: 180)
        .scaleEffect(isHovered ? 1.02 : 1.0)
        .shadow(
            color: entry.emotionalColor.opacity(isHovered ? 0.3 : 0.1),
            radius: isHovered ? 20 : 5
        )
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovered)
    }
}

struct EmotionalCloudView: View {
    let entry: MemoryEntry
    @State private var phase: CGFloat = 0
    
    var body: some View {
        Circle()
            .fill(
                RadialGradient(
                    colors: [
                        entry.emotionalColor.opacity(0.05),
                        entry.emotionalColor.opacity(0.02),
                        Color.clear
                    ],
                    center: .center,
                    startRadius: 50,
                    endRadius: 200
                )
            )
            .frame(width: 400, height: 400)
            .blur(radius: 40)
            .offset(
                x: sin(phase) * 100,
                y: cos(phase * 1.3) * 80
            )
            .position(
                x: CGFloat.random(in: 100...1340),
                y: CGFloat.random(in: 100...800)
            )
            .onAppear {
                withAnimation(.linear(duration: 60).repeatForever(autoreverses: false)) {
                    phase = .pi * 2
                }
            }
    }
}

struct AddMemoryView: View {
    @Binding var text: String
    @Binding var isPresented: Bool
    let onSave: () -> Void
    @FocusState private var isFocused: Bool
    
    var body: some View {
        ZStack {
            Color.black.opacity(0.8)
                .ignoresSafeArea()
                .onTapGesture {
                    isPresented = false
                }
            
            VStack(spacing: 20) {
                Text("What happened today?")
                    .font(.system(size: 24, weight: .light, design: .serif))
                    .foregroundColor(.white.opacity(0.8))
                
                TextEditor(text: $text)
                    .font(.system(size: 16, design: .serif))
                    .foregroundColor(.white)
                    .scrollContentBackground(.hidden)
                    .background(Color.white.opacity(0.05))
                    .cornerRadius(8)
                    .focused($isFocused)
                    .frame(width: 500, height: 200)
                
                HStack(spacing: 20) {
                    Button("Cancel") {
                        isPresented = false
                        text = ""
                    }
                    .buttonStyle(PlainButtonStyle())
                    .foregroundColor(.gray)
                    
                    Button("Remember") {
                        onSave()
                        isPresented = false
                    }
                    .buttonStyle(PlainButtonStyle())
                    .foregroundColor(.white)
                }
            }
            .padding(40)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color.black)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(Color.white.opacity(0.1), lineWidth: 1)
                    )
            )
        }
        .onAppear {
            isFocused = true
        }
    }
}