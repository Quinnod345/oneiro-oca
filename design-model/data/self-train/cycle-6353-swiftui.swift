struct ContentView: View {
    @State private var excavationLayers: [[ExcavationCell]] = Array(repeating: Array(repeating: ExcavationCell(), count: 40), count: 25)
    @State private var revealedMessages: [ArchaeologicalMessage] = []
    @State private var brushPosition: CGPoint = .zero
    @State private var brushPressure: Double = 0
    @State private var activeExcavation: UUID?
    @State private var museumCollection: [PreservedConversation] = []
    @State private var showingMuseum = false
    @State private var excavationDepth: Double = 0
    @State private var currentTool: ExcavationTool = .brush
    
    let gridColumns = Array(repeating: GridItem(.fixed(36), spacing: 0), count: 40)
    
    var body: some View {
        ZStack {
            // Sediment layers background
            LinearGradient(colors: [
                Color(red: 0.15, green: 0.12, blue: 0.10),
                Color(red: 0.25, green: 0.20, blue: 0.18),
                Color(red: 0.35, green: 0.28, blue: 0.25)
            ], startPoint: .top, endPoint: .bottom)
            .ignoresSafeArea()
            
            VStack(spacing: 0) {
                // Tool palette
                HStack(spacing: 20) {
                    ForEach(ExcavationTool.allCases) { tool in
                        ToolButton(tool: tool, isSelected: currentTool == tool)
                            .onTapGesture { currentTool = tool }
                    }
                    
                    Spacer()
                    
                    Button(action: { showingMuseum.toggle() }) {
                        HStack(spacing: 8) {
                            Image(systemName: "building.columns.fill")
                            Text("Museum (\(museumCollection.count))")
                                .font(.system(size: 13, weight: .medium))
                        }
                        .foregroundColor(Color(red: 0.85, green: 0.75, blue: 0.60))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Color(red: 0.20, green: 0.16, blue: 0.14))
                        .cornerRadius(20)
                    }
                    .buttonStyle(PlainButtonStyle())
                }
                .padding(.horizontal, 30)
                .padding(.vertical, 20)
                
                // Main excavation area
                ZStack {
                    // Sediment grid
                    LazyVGrid(columns: gridColumns, spacing: 0) {
                        ForEach(0..<25 * 40, id: \.self) { index in
                            let row = index / 40
                            let col = index % 40
                            
                            SedimentCell(
                                cell: excavationLayers[row][col],
                                depth: excavationDepth,
                                tool: currentTool
                            )
                            .onContinuousHover { phase in
                                if case .active(let location) = phase {
                                    excavateAt(row: row, col: col, intensity: currentTool.intensity)
                                    brushPosition = location
                                }
                            }
                        }
                    }
                    .padding(40)
                    
                    // Revealed message fragments
                    ForEach(revealedMessages) { message in
                        MessageFragment(message: message)
                            .position(message.position)
                            .onTapGesture {
                                if message.clarity > 0.8 {
                                    crystallizeMessage(message)
                                }
                            }
                    }
                    
                    // Brush cursor effect
                    if brushPressure > 0 {
                        BrushCursor(position: brushPosition, pressure: brushPressure, tool: currentTool)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(red: 0.18, green: 0.15, blue: 0.13))
                .cornerRadius(8)
                .padding(.horizontal, 20)
                .padding(.bottom, 20)
            }
            
            if showingMuseum {
                MuseumView(collection: $museumCollection, isShowing: $showingMuseum)
            }
        }
        .frame(width: 1440, height: 900)
        .onAppear { initializeExcavation() }
    }
    
    func initializeExcavation() {
        // Bury messages in sediment layers
        let buriedMessages = [
            "remember when we stayed up all night talking about the stars?",
            "i miss those sunday morning coffee runs",
            "you were right about everything",
            "why did we let it end like that?",
            "the playlist you made still makes me cry",
            "i kept all your letters in that shoebox",
            "do you still think about prague?",
            "that last fight wasn't really about the dishes"
        ]
        
        for (index, text) in buriedMessages.enumerated() {
            let message = ArchaeologicalMessage(
                text: text,
                depth: Double.random(in: 3...8),
                position: CGPoint(
                    x: CGFloat.random(in: 100...1300),
                    y: CGFloat.random(in: 150...700)
                )
            )
            
            // Mark cells containing messages
            let gridX = Int(message.position.x / 36)
            let gridY = Int((message.position.y - 150) / 36)
            
            if gridX >= 0 && gridX < 40 && gridY >= 0 && gridY < 25 {
                excavationLayers[gridY][gridX].hasMessage = true
                excavationLayers[gridY][gridX].messageId = message.id
            }
        }
    }
    
    func excavateAt(row: Int, col: Int, intensity: Double) {
        guard row >= 0 && row < 25 && col >= 0 && col < 40 else { return }
        
        excavationLayers[row][col].excavate(by: intensity)
        
        // Check for message revelation
        if excavationLayers[row][col].hasMessage && excavationLayers[row][col].excavationLevel > 0.6 {
            if !revealedMessages.contains(where: { $0.id == excavationLayers[row][col].messageId }) {
                // Create new revealed message
                let message = ArchaeologicalMessage(
                    text: "fragment emerging...",
                    depth: excavationLayers[row][col].excavationLevel,
                    position: CGPoint(
                        x: CGFloat(col * 36 + 20),
                        y: CGFloat(row * 36 + 150)
                    )
                )
                revealedMessages.append(message)
            }
        }
        
        // Damage messages if brushing too hard
        for i in revealedMessages.indices {
            let distance = sqrt(pow(revealedMessages[i].position.x - CGFloat(col * 36), 2) + 
                              pow(revealedMessages[i].position.y - CGFloat(row * 36), 2))
            if distance < 50 && intensity > 0.7 {
                revealedMessages[i].damage(by: intensity * 0.1)
            } else if distance < 100 && intensity < 0.5 {
                revealedMessages[i].clarify(by: intensity * 0.05)
            }
        }
    }
    
    func crystallizeMessage(_ message: ArchaeologicalMessage) {
        let preserved = PreservedConversation(
            text: message.text,
            excavationDate: Date(),
            clarity: message.clarity,
            depth: message.depth
        )
        museumCollection.append(preserved)
        revealedMessages.removeAll { $0.id == message.id }
    }
}

struct ExcavationCell {
    var excavationLevel: Double = 0
    var sedimentColor: Color = Color(red: 0.3, green: 0.25, blue: 0.2)
    var hasMessage: Bool = false
    var messageId: UUID?
    var cracks: [Crack] = []
    
    mutating func excavate(by intensity: Double) {
        excavationLevel = min(1.0, excavationLevel + intensity * 0.02)
        
        // Add cracks if excavating too aggressively
        if intensity > 0.7 && Double.random(in: 0...1) < 0.1 {
            cracks.append(Crack())
        }
    }
}

struct Crack {
    let angle: Double = Double.random(in: 0...360)
    let length: Double = Double.random(in: 10...30)
}

struct SedimentCell: View {
    let cell: ExcavationCell
    let depth: Double
    let tool: ExcavationTool
    
    var body: some View {
        ZStack {
            Rectangle()
                .fill(sedimentGradient)
                .frame(width: 36, height: 36)
            
            // Excavation texture
            if cell.excavationLevel > 0 {
                Rectangle()
                    .fill(Color.black.opacity(0.1))
                    .frame(width: 36, height: 36)
                    .mask(
                        LinearGradient(colors: [
                            Color.white.opacity(cell.excavationLevel),
                            Color.clear
                        ], startPoint: .top, endPoint: .bottom)
                    )
            }
            
            // Cracks
            ForEach(cell.cracks.indices, id: \.self) { index in
                CrackView(crack: cell.cracks[index])
            }
        }
    }
    
    var sedimentGradient: LinearGradient {
        let baseColor = Color(
            red: 0.3 - cell.excavationLevel * 0.1,
            green: 0.25 - cell.excavationLevel * 0.1,
            blue: 0.2 - cell.excavationLevel * 0.1
        )
        
        return LinearGradient(
            colors: [baseColor, baseColor.opacity(0.8)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

struct CrackView: View {
    let crack: Crack
    
    var body: some View {
        Path { path in
            path.move(to: CGPoint(x: 18, y: 18))
            let endX = 18 + cos(crack.angle * .pi / 180) * crack.length
            let endY = 18 + sin(crack.angle * .pi / 180) * crack.length
            path.addLine(to: CGPoint(x: endX, y: endY))
        }
        .stroke(Color.black.opacity(0.3), lineWidth: 0.5)
    }
}

struct ArchaeologicalMessage: Identifiable {
    let id = UUID()
    var text: String
    var clarity: Double = 0.1
    var integrity: Double = 1.0
    var depth: Double
    var position: CGPoint
    var fragments: [String] = []
    
    init(text: String, depth: Double, position: CGPoint) {
        self.text = text
        self.depth = depth
        self.position = position
        self.fragments = text.split(separator: " ").map(String.init)
    }
    
    mutating func damage(by amount: Double) {
        integrity = max(0, integrity - amount)
        if integrity < 0.3 {
            clarity *= 0.9
        }
    }
    
    mutating func clarify(by amount: Double) {
        if integrity > 0.5 {
            clarity = min(1.0, clarity + amount)
        }
    }
}

struct MessageFragment: View {
    let message: ArchaeologicalMessage
    
    var body: some View {
        Text(visibleText)
            .font(.system(size: 14, weight: .regular))
            .foregroundColor(textColor)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(backgroundGradient)
            .cornerRadius(4)
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(borderColor, lineWidth: 1)
            )
            .opacity(message.integrity)
            .blur(radius: (1 - message.clarity) * 5)
            .scaleEffect(message.clarity > 0.8 ? 1.05 : 1.0)
            .animation(.spring(response: 0.6, dampingFraction: 0.8), value: message.clarity)
    }
    
    var visibleText: String {
        if message.clarity < 0.3 {
            return String(repeating: "█", count: message.text.count)
        } else if message.clarity < 0.6 {
            return message.text.map { char in
                Double.random(in: 0...1) < message.clarity ? String(char) : "▒"
            }.joined()
        } else {
            return message.text
        }
    }
    
    var textColor: Color {
        if message.clarity > 0.8 {
            return Color(red: 0.95, green: 0.85, blue: 0.65)
        } else {
            return Color(red: 0.6, green: 0.5, blue: 0.4)
        }
    }
    
    var backgroundGradient: LinearGradient {
        if message.clarity > 0.8 {
            return LinearGradient(
                colors: [
                    Color(red: 0.85, green: 0.65, blue: 0.35).opacity(0.3),
                    Color(red: 0.90, green: 0.70, blue: 0.40).opacity(0.2)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        } else {
            return LinearGradient(
                colors: [
                    Color(red: 0.25, green: 0.20, blue: 0.15).opacity(0.8),
                    Color(red: 0.20, green: 0.16, blue: 0.12).opacity(0.7)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
    }
    
    var borderColor: Color {
        if message.clarity > 0.8 {
            return Color(red: 0.95, green: 0.75, blue: 0.45).opacity(0.6)
        } else {
            return Color.clear
        }
    }
}

enum ExcavationTool: String, CaseIterable, Identifiable {
    case brush = "paintbrush"
    case pick = "hammer"
    case airbrush = "wind"
    
    var id: String { rawValue }
    
    var intensity: Double {
        switch self {
        case .brush: return 0.3
        case .pick: return 0.8
        case .airbrush: return 0.15
        }
    }
    
    var systemName: String {
        switch self {
        case .brush: return "paintbrush.fill"
        case .pick: return "hammer.fill"
        case .airbrush: return "wind"
        }
    }
}

struct ToolButton: View {
    let tool: ExcavationTool
    let isSelected: Bool
    
    var body: some View {
        Image(systemName: tool.systemName)
            .font(.system(size: 20))
            .foregroundColor(isSelected ? Color(red: 0.95, green: 0.75, blue: 0.45) : Color.gray)
            .frame(width: 44, height: 44)
            .background(isSelected ? Color(red: 0.25, green: 0.20, blue: 0.15) : Color.clear)
            .cornerRadius(8)
    }
}

struct BrushCursor: View {
    let position: CGPoint
    let pressure: Double
    let tool: ExcavationTool
    
    var body: some View {
        Circle()
            .fill(Color(red: 0.95, green: 0.85, blue: 0.65).opacity(0.2))
            .frame(width: tool.intensity * 100, height: tool.intensity * 100)
            .position(position)
            .allowsHitTesting(false)
    }
}

struct PreservedConversation: Identifiable {
    let id = UUID()
    let text: String
    let excavationDate: Date
    let clarity: Double
    let depth: Double
}

struct MuseumView: View {
    @Binding var collection: [PreservedConversation]
    @Binding var isShowing: Bool
    
    var body: some View {
        ZStack {
            Color.black.opacity(0.8)
                .ignoresSafeArea()
                .onTapGesture { isShowing = false }
            
            VStack(spacing: 30) {
                Text("MUSEUM OF RECOVERED CONVERSATIONS")
                    .font(.system(size: 24, weight: .light))
                    .foregroundColor(Color(red: 0.95, green: 0.85, blue: 0.65))
                    .tracking(3)
                
                ScrollView {
                    VStack(spacing: 20) {
                        ForEach(collection) { preserved in
                            PreservedDisplay(conversation: preserved)
                        }
                    }
                    .padding(40)
                }
                .frame(maxHeight: 600)
            }
            .frame(width: 1000)
            .background(Color(red: 0.12, green: 0.10, blue: 0.08))
            .cornerRadius(20)
        }
    }
}

struct PreservedDisplay: View {
    let conversation: PreservedConversation
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(conversation.text)
                .font(.system(size: 18, weight: .regular))
                .foregroundColor(Color(red: 0.95, green: 0.85, blue: 0.65))
            
            HStack {
                Label("Excavated: \(conversation.excavationDate.formatted(date: .abbreviated, time: .shortened))", systemImage: "calendar")
                    .font(.system(size: 12))
                    .foregroundColor(Color.gray)
                
                Spacer()
                
                Label("Clarity: \(Int(conversation.clarity * 100))%", systemImage: "eye")
                    .font(.system(size: 12))
                    .foregroundColor(Color.gray)
                
                Label("Depth: \(String(format: "%.1fm", conversation.depth))", systemImage: "arrow.down")
                    .font(.system(size: 12))
                    .foregroundColor(Color.gray)
            }
        }
        .padding(24)
        .background(
            LinearGradient(
                colors: [
                    Color(red: 0.85, green: 0.65, blue: 0.35).opacity(0.1),
                    Color(red: 0.90, green: 0.70, blue: 0.40).opacity(0.05)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color(red: 0.95, green: 0.75, blue: 0.45).opacity(0.3), lineWidth: 1)
        )
    }
}