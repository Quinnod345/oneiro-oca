struct ContentView: View {
    @State private var entries: [MemoryEntry] = []
    @State private var selectedEntry: MemoryEntry?
    @State private var isAddingMemory = false
    @State private var newMemoryText = ""
    @State private var hoveredEntry: MemoryEntry?
    
    let timer = Timer.publish(every: 60, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            Color(white: 0.05).ignoresSafeArea()
            
            ScrollView {
                LazyVGrid(columns: [
                    GridItem(.adaptive(minimum: 280, maximum: 320), spacing: 24)
                ], spacing: 24) {
                    ForEach(entries) { entry in
                        MemoryCard(
                            entry: entry,
                            isHovered: hoveredEntry?.id == entry.id
                        )
                        .onHover { hovering in
                            withAnimation(.easeOut(duration: 0.2)) {
                                hoveredEntry = hovering ? entry : nil
                            }
                        }
                        .onTapGesture {
                            withAnimation(.easeOut(duration: 0.3)) {
                                selectedEntry = entry
                            }
                        }
                    }
                }
                .padding(48)
            }
            
            VStack {
                HStack {
                    Spacer()
                    Button(action: { 
                        withAnimation(.easeOut(duration: 0.2)) {
                            isAddingMemory = true
                        }
                    }) {
                        ZStack {
                            Circle()
                                .fill(Color.white.opacity(0.08))
                                .frame(width: 48, height: 48)
                            
                            Image(systemName: "plus")
                                .font(.system(size: 20, weight: .regular))
                                .foregroundColor(.white.opacity(0.6))
                        }
                    }
                    .buttonStyle(PlainButtonStyle())
                    .scaleEffect(hoveredEntry == nil ? 1 : 0.95)
                    .animation(.easeOut(duration: 0.2), value: hoveredEntry)
                }
                .padding(48)
                Spacer()
            }
            
            if isAddingMemory {
                ZStack {
                    Color.black.opacity(0.8)
                        .ignoresSafeArea()
                        .onTapGesture {
                            withAnimation(.easeOut(duration: 0.2)) {
                                isAddingMemory = false
                                newMemoryText = ""
                            }
                        }
                    
                    AddMemoryView(
                        text: $newMemoryText,
                        isPresented: $isAddingMemory,
                        onSave: {
                            let hue = Double.random(in: 0...1)
                            let entry = MemoryEntry(
                                text: newMemoryText,
                                timestamp: Date(),
                                hue: hue
                            )
                            withAnimation(.easeOut(duration: 0.3)) {
                                entries.insert(entry, at: 0)
                            }
                            newMemoryText = ""
                        }
                    )
                }
            }
            
            if let selected = selectedEntry {
                ZStack {
                    Color.black.opacity(0.9)
                        .ignoresSafeArea()
                        .onTapGesture {
                            withAnimation(.easeOut(duration: 0.3)) {
                                selectedEntry = nil
                            }
                        }
                    
                    DetailView(entry: selected)
                }
            }
        }
        .frame(width: 1440, height: 900)
        .onReceive(timer) { _ in
            withAnimation(.linear(duration: 0.5)) {
                entries = entries.map { $0.aged() }
            }
        }
    }
}

struct MemoryEntry: Identifiable {
    let id = UUID()
    let text: String
    let timestamp: Date
    let hue: Double
    var decayLevel: Double = 0.0
    
    func aged() -> MemoryEntry {
        var aged = self
        let hoursSince = Date().timeIntervalSince(timestamp) / 3600
        aged.decayLevel = min(1.0, hoursSince / (365 * 24))
        return aged
    }
    
    var emotionalColor: Color {
        Color(hue: hue, saturation: 0.4 * (1 - decayLevel * 0.5), brightness: 0.8 * (1 - decayLevel * 0.3))
    }
    
    var opacity: Double {
        max(0.3, 1.0 - decayLevel * 0.7)
    }
    
    var distortedText: String {
        guard decayLevel > 0.3 else { return text }
        
        let words = text.split(separator: " ")
        let distortionLevel = Int(decayLevel * Double(words.count))
        
        var distorted = words.map(String.init)
        for i in 0..<min(distortionLevel, distorted.count) {
            let index = (i * 3) % distorted.count
            if decayLevel > 0.7 {
                distorted[index] = String(repeating: "·", count: distorted[index].count)
            } else if decayLevel > 0.5 {
                let chars = Array(distorted[index])
                if chars.count > 2 {
                    distorted[index] = String(chars.prefix(1)) + String(repeating: "·", count: chars.count - 2) + String(chars.suffix(1))
                }
            }
        }
        
        return distorted.joined(separator: " ")
    }
}

struct MemoryCard: View {
    let entry: MemoryEntry
    let isHovered: Bool
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(RelativeDateFormatter.shared.string(from: entry.timestamp))
                .font(.system(size: 11, weight: .regular, design: .monospaced))
                .foregroundColor(.white.opacity(0.4 * entry.opacity))
            
            Text(entry.distortedText)
                .font(.system(size: 15, weight: .regular))
                .foregroundColor(.white.opacity(0.8 * entry.opacity))
                .lineLimit(4)
                .multilineTextAlignment(.leading)
                .blur(radius: entry.decayLevel * 2)
            
            Spacer()
        }
        .padding(20)
        .frame(maxWidth: .infinity, minHeight: 160)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(entry.emotionalColor.opacity(0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(entry.emotionalColor.opacity(0.2), lineWidth: 1)
                )
        )
        .scaleEffect(isHovered ? 1.02 : 1.0)
        .shadow(color: entry.emotionalColor.opacity(isHovered ? 0.2 : 0), radius: 20)
    }
}

struct AddMemoryView: View {
    @Binding var text: String
    @Binding var isPresented: Bool
    let onSave: () -> Void
    @FocusState private var isFocused: Bool
    
    var body: some View {
        VStack(spacing: 24) {
            Text("New Memory")
                .font(.system(size: 20, weight: .regular))
                .foregroundColor(.white.opacity(0.9))
            
            TextEditor(text: $text)
                .font(.system(size: 16, weight: .regular))
                .foregroundColor(.white.opacity(0.9))
                .scrollContentBackground(.hidden)
                .background(Color.white.opacity(0.05))
                .padding(16)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(Color.white.opacity(0.1), lineWidth: 1)
                )
                .focused($isFocused)
            
            HStack(spacing: 16) {
                Button("Cancel") {
                    withAnimation(.easeOut(duration: 0.2)) {
                        isPresented = false
                        text = ""
                    }
                }
                .buttonStyle(SecondaryButtonStyle())
                
                Button("Save") {
                    if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        onSave()
                        withAnimation(.easeOut(duration: 0.2)) {
                            isPresented = false
                        }
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(32)
        .frame(width: 480, height: 320)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(white: 0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(Color.white.opacity(0.1), lineWidth: 1)
                )
        )
        .shadow(color: .black.opacity(0.5), radius: 40)
        .onAppear {
            isFocused = true
        }
    }
}

struct DetailView: View {
    let entry: MemoryEntry
    
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text(DateFormatter.shared.string(from: entry.timestamp))
                .font(.system(size: 14, weight: .regular, design: .monospaced))
                .foregroundColor(.white.opacity(0.5))
            
            ScrollView {
                Text(entry.text)
                    .font(.system(size: 18, weight: .regular))
                    .foregroundColor(.white.opacity(0.9))
                    .lineSpacing(8)
            }
            
            HStack {
                Text("Decay: \(Int(entry.decayLevel * 100))%")
                    .font(.system(size: 12, weight: .regular, design: .monospaced))
                    .foregroundColor(entry.emotionalColor.opacity(0.6))
                
                Spacer()
            }
        }
        .padding(40)
        .frame(width: 600, maxHeight: 500)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(white: 0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(entry.emotionalColor.opacity(0.2), lineWidth: 1)
                )
        )
        .shadow(color: .black.opacity(0.5), radius: 40)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .regular))
            .foregroundColor(.white.opacity(0.9))
            .padding(.horizontal, 24)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.white.opacity(configuration.isPressed ? 0.08 : 0.1))
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .regular))
            .foregroundColor(.white.opacity(0.6))
            .padding(.horizontal, 24)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .strokeBorder(Color.white.opacity(0.1), lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

extension RelativeDateFormatter {
    static let shared: RelativeDateFormatter = {
        let formatter = RelativeDateFormatter()
        formatter.unitsStyle = .abbreviated
        formatter.dateTimeStyle = .numeric
        return formatter
    }()
}

extension DateFormatter {
    static let shared: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, yyyy 'at' h:mm a"
        return formatter
    }()
}