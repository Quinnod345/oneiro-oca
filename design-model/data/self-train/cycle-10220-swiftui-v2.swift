struct ContentView: View {
    @State private var currentDream: String = ""
    @State private var entries: [DreamEntry] = []
    @State private var selectedTheme: DreamTheme?
    @State private var fadeOpacity: Double = 1.0
    @State private var lastInteraction = Date()
    
    let themes: [DreamTheme] = [
        DreamTheme(name: "Flight", color: Color(red: 0.4, green: 0.6, blue: 0.9)),
        DreamTheme(name: "Water", color: Color(red: 0.2, green: 0.5, blue: 0.8)),
        DreamTheme(name: "Chase", color: Color(red: 0.9, green: 0.3, blue: 0.3)),
        DreamTheme(name: "Lost", color: Color(red: 0.6, green: 0.4, blue: 0.7))
    ]
    
    let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()
            
            VStack(spacing: 32) {
                Text("DREAM JOURNAL")
                    .font(.system(size: 24, weight: .thin, design: .default))
                    .foregroundColor(.white)
                    .opacity(fadeOpacity)
                    .padding(.top, 40)
                
                VStack(alignment: .leading, spacing: 16) {
                    Text("Tonight's dream")
                        .font(.system(size: 14, weight: .regular))
                        .foregroundColor(.white.opacity(0.6))
                    
                    TextEditor(text: $currentDream)
                        .font(.system(size: 16, weight: .regular))
                        .foregroundColor(.white)
                        .scrollContentBackground(.hidden)
                        .background(Color.white.opacity(0.08))
                        .cornerRadius(8)
                        .frame(height: 120)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.white.opacity(0.2), lineWidth: 1)
                        )
                        .onChange(of: currentDream) { _ in
                            lastInteraction = Date()
                            withAnimation(.easeIn(duration: 0.3)) {
                                fadeOpacity = 1.0
                            }
                        }
                }
                .padding(.horizontal, 24)
                
                HStack(spacing: 12) {
                    ForEach(themes) { theme in
                        Button(action: {
                            selectedTheme = theme
                            lastInteraction = Date()
                            withAnimation(.easeIn(duration: 0.3)) {
                                fadeOpacity = 1.0
                            }
                        }) {
                            Text(theme.name)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(selectedTheme?.id == theme.id ? .black : .white)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                                .background(
                                    selectedTheme?.id == theme.id ? 
                                    theme.color : Color.clear
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: 20)
                                        .stroke(theme.color, lineWidth: 1)
                                )
                                .cornerRadius(20)
                        }
                    }
                }
                .padding(.horizontal, 24)
                
                Button(action: {
                    if !currentDream.isEmpty && selectedTheme != nil {
                        let entry = DreamEntry(
                            content: currentDream,
                            theme: selectedTheme!,
                            timestamp: Date()
                        )
                        entries.append(entry)
                        currentDream = ""
                        selectedTheme = nil
                        lastInteraction = Date()
                    }
                }) {
                    Text("Save Dream")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white)
                        .padding(.horizontal, 32)
                        .padding(.vertical, 12)
                        .background(
                            Color.white
                                .opacity(currentDream.isEmpty || selectedTheme == nil ? 0.1 : 0.2)
                        )
                        .cornerRadius(8)
                }
                .disabled(currentDream.isEmpty || selectedTheme == nil)
                
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        ForEach(entries.reversed()) { entry in
                            DreamEntryView(entry: entry, fadeOpacity: fadeOpacity)
                        }
                    }
                    .padding(.horizontal, 24)
                }
                .frame(maxHeight: 400)
                
                Spacer()
            }
            .opacity(fadeOpacity)
        }
        .onReceive(timer) { _ in
            let elapsed = Date().timeIntervalSince(lastInteraction)
            if elapsed > 30 {
                withAnimation(.easeOut(duration: 5)) {
                    fadeOpacity = max(0.3, 1.0 - (elapsed - 30) / 270)
                }
            }
        }
    }
}

struct DreamEntryView: View {
    let entry: DreamEntry
    let fadeOpacity: Double
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Circle()
                    .fill(entry.theme.color)
                    .frame(width: 8, height: 8)
                
                Text(entry.theme.name)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(entry.theme.color)
                
                Spacer()
                
                Text(timeAgo(from: entry.timestamp))
                    .font(.system(size: 12))
                    .foregroundColor(.white.opacity(0.4))
            }
            
            Text(entry.content)
                .font(.system(size: 14))
                .foregroundColor(.white.opacity(0.8))
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .background(Color.white.opacity(0.05))
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(entry.theme.color.opacity(0.3), lineWidth: 1)
        )
    }
    
    func timeAgo(from date: Date) -> String {
        let minutes = Int(Date().timeIntervalSince(date) / 60)
        if minutes < 60 {
            return "\(minutes)m ago"
        } else if minutes < 1440 {
            return "\(minutes / 60)h ago"
        } else {
            return "\(minutes / 1440)d ago"
        }
    }
}

struct DreamEntry: Identifiable {
    let id = UUID()
    let content: String
    let theme: DreamTheme
    let timestamp: Date
}

struct DreamTheme: Identifiable {
    let id = UUID()
    let name: String
    let color: Color
}