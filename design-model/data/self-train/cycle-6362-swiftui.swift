struct ContentView: View {
    @State private var dailySleepEntries: [SleepEntry] = []
    @State private var shadowCreature = ShadowCreature()
    @State private var selectedDay = Date()
    @State private var hoveredTendril: UUID?
    @State private var activeChallenges: [SleepChallenge] = []
    @State private var dreamThreads: [DreamThread] = []
    @State private var timelineOffset: CGFloat = 0
    @State private var creaturePhase: CGFloat = 0
    
    let timer = Timer.publish(every: 0.016, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            // Dark gradient that shifts with sleep debt
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.05, blue: 0.08).opacity(1 - shadowCreature.health),
                    Color(red: 0.02, green: 0.02, blue: 0.03)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            
            // Geometric fragments background
            GeometryReader { geometry in
                ForEach(shadowCreature.fragments) { fragment in
                    Path { path in
                        path.move(to: fragment.points[0])
                        fragment.points.forEach { path.addLine(to: $0) }
                        path.closeSubpath()
                    }
                    .fill(Color.white.opacity(0.03 * fragment.brightness))
                    .blur(radius: 2 - fragment.brightness)
                    .offset(fragment.offset)
                }
            }
            
            VStack(spacing: 0) {
                // Dream catcher protection visualization
                ZStack {
                    ForEach(dreamThreads) { thread in
                        LuminousThread(thread: thread, phase: creaturePhase)
                    }
                }
                .frame(height: 120)
                .opacity(dreamThreads.isEmpty ? 0 : 1)
                
                // Main timeline view
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 2) {
                        ForEach(-3...10, id: \.self) { dayOffset in
                            let date = Calendar.current.date(byAdding: .day, value: dayOffset, to: Date()) ?? Date()
                            DayColumn(
                                date: date,
                                sleepEntry: sleepEntry(for: date),
                                tendrils: shadowCreature.tendrils.filter { 
                                    Calendar.current.isDate($0.targetDate, inSameDayAs: date)
                                },
                                isToday: dayOffset == 0,
                                hoveredTendril: $hoveredTendril,
                                onSleepInput: { hours in
                                    updateSleep(for: date, hours: hours)
                                }
                            )
                        }
                    }
                    .padding(.horizontal, 100)
                }
                .offset(x: timelineOffset)
                
                // Shadow creature visualization
                ZStack {
                    CreatureBody(
                        creature: shadowCreature,
                        phase: creaturePhase,
                        hoveredTendril: hoveredTendril
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .frame(height: 400)
                
                // Battle challenges
                HStack(spacing: 20) {
                    ForEach(SleepChallenge.available) { challenge in
                        ChallengeCard(
                            challenge: challenge,
                            isActive: activeChallenges.contains(where: { $0.id == challenge.id }),
                            onActivate: { activateChallenge(challenge) }
                        )
                    }
                }
                .padding(.horizontal, 40)
                .padding(.bottom, 30)
            }
        }
        .onReceive(timer) { _ in
            withAnimation(.linear(duration: 0.016)) {
                creaturePhase += 0.01
                shadowCreature.pulse()
                updateDreamThreads()
            }
        }
    }
    
    func sleepEntry(for date: Date) -> SleepEntry? {
        dailySleepEntries.first { Calendar.current.isDate($0.date, inSameDayAs: date) }
    }
    
    func updateSleep(for date: Date, hours: Double) {
        if let index = dailySleepEntries.firstIndex(where: { Calendar.current.isDate($0.date, inSameDayAs: date) }) {
            dailySleepEntries[index].hours = hours
        } else {
            dailySleepEntries.append(SleepEntry(date: date, hours: hours))
        }
        
        withAnimation(.easeInOut(duration: 0.8)) {
            shadowCreature.recalculate(from: dailySleepEntries)
        }
    }
    
    func activateChallenge(_ challenge: SleepChallenge) {
        activeChallenges.append(challenge)
        
        // Transform tendrils to dream threads
        withAnimation(.easeInOut(duration: 1.2)) {
            let affectedTendrils = shadowCreature.tendrils.filter { $0.function == challenge.targetFunction }
            for tendril in affectedTendrils {
                dreamThreads.append(DreamThread(from: tendril))
            }
            shadowCreature.tendrils.removeAll { tendril in
                affectedTendrils.contains { $0.id == tendril.id }
            }
        }
    }
    
    func updateDreamThreads() {
        dreamThreads = dreamThreads.map { thread in
            var updated = thread
            updated.waveOffset += 0.02
            return updated
        }
    }
}

struct SleepEntry: Identifiable {
    let id = UUID()
    let date: Date
    var hours: Double
}

struct ShadowCreature {
    var health: CGFloat = 0.5
    var tendrils: [Tendril] = []
    var fragments: [Fragment] = []
    
    init() {
        generateFragments()
    }
    
    mutating func generateFragments() {
        for _ in 0..<20 {
            fragments.append(Fragment())
        }
    }
    
    mutating func recalculate(from entries: [SleepEntry]) {
        let totalDebt = entries.reduce(0) { sum, entry in
            sum + max(0, 8 - entry.hours)
        }
        
        health = max(0, 1 - (totalDebt / 40))
        
        // Generate tendrils for sleep debt
        tendrils.removeAll()
        
        if totalDebt > 0 {
            let tendrilCount = Int(totalDebt / 2)
            for i in 0..<tendrilCount {
                let function = CognitiveFunction.allCases.randomElement() ?? .memory
                let targetDate = Calendar.current.date(byAdding: .day, value: i % 7, to: Date()) ?? Date()
                tendrils.append(Tendril(function: function, targetDate: targetDate, strength: min(1, totalDebt / 20)))
            }
        }
        
        // Update fragments based on health
        fragments = fragments.map { fragment in
            var updated = fragment
            updated.brightness = health
            return updated
        }
    }
    
    mutating func pulse() {
        fragments = fragments.map { fragment in
            var updated = fragment
            updated.offset.width += sin(updated.phase) * 0.2
            updated.offset.height += cos(updated.phase * 1.3) * 0.15
            updated.phase += 0.02
            return updated
        }
    }
}

struct Fragment: Identifiable {
    let id = UUID()
    var points: [CGPoint]
    var brightness: CGFloat
    var offset: CGSize
    var phase: CGFloat
    
    init() {
        // Generate random triangular fragment
        let size = CGFloat.random(in: 20...60)
        points = [
            CGPoint(x: CGFloat.random(in: 0...1440), y: CGFloat.random(in: 0...900)),
            CGPoint(x: CGFloat.random(in: 0...1440), y: CGFloat.random(in: 0...900)),
            CGPoint(x: CGFloat.random(in: 0...1440), y: CGFloat.random(in: 0...900))
        ]
        brightness = CGFloat.random(in: 0.3...1)
        offset = .zero
        phase = CGFloat.random(in: 0...(.pi * 2))
    }
}

struct Tendril: Identifiable {
    let id = UUID()
    let function: CognitiveFunction
    let targetDate: Date
    let strength: CGFloat
}

enum CognitiveFunction: String, CaseIterable {
    case memory = "Memory"
    case reaction = "Reaction Time"
    case creativity = "Creativity"
    case focus = "Focus"
    case emotion = "Emotional Regulation"
    
    var color: Color {
        switch self {
        case .memory: return Color(red: 0.6, green: 0.3, blue: 0.9)
        case .reaction: return Color(red: 0.9, green: 0.3, blue: 0.3)
        case .creativity: return Color(red: 0.3, green: 0.7, blue: 0.9)
        case .focus: return Color(red: 0.9, green: 0.7, blue: 0.3)
        case .emotion: return Color(red: 0.5, green: 0.9, blue: 0.5)
        }
    }
}

struct DayColumn: View {
    let date: Date
    let sleepEntry: SleepEntry?
    let tendrils: [Tendril]
    let isToday: Bool
    @Binding var hoveredTendril: UUID?
    let onSleepInput: (Double) -> Void
    
    @State private var inputHours: String = ""
    @State private var isEditing = false
    
    var body: some View {
        VStack(spacing: 0) {
            // Date header
            VStack(spacing: 4) {
                Text(date.formatted(.dateTime.weekday(.abbreviated)))
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.gray)
                Text(date.formatted(.dateTime.day()))
                    .font(.system(size: 18, weight: isToday ? .bold : .regular))
                    .foregroundColor(isToday ? .white : Color(white: 0.8))
            }
            .padding(.vertical, 12)
            
            // Sleep input
            ZStack {
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color(white: 0.1))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(isEditing ? Color.blue : Color(white: 0.2), lineWidth: 1)
                    )
                
                if isEditing {
                    TextField("", text: $inputHours)
                        .textFieldStyle(.plain)
                        .foregroundColor(.white)
                        .multilineTextAlignment(.center)
                        .onSubmit {
                            if let hours = Double(inputHours) {
                                onSleepInput(hours)
                            }
                            isEditing = false
                        }
                } else {
                    Text(sleepEntry?.hours != nil ? String(format: "%.1fh", sleepEntry!.hours) : "-")
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundColor(Color(white: 0.7))
                        .onTapGesture {
                            inputHours = sleepEntry?.hours != nil ? String(format: "%.1f", sleepEntry!.hours) : ""
                            isEditing = true
                        }
                }
            }
            .frame(width: 60, height: 32)
            
            // Tendril attachments
            ZStack {
                ForEach(tendrils) { tendril in
                    TendrilAttachment(
                        tendril: tendril,
                        isHovered: hoveredTendril == tendril.id
                    )
                    .onHover { hovering in
                        hoveredTendril = hovering ? tendril.id : nil
                    }
                }
            }
            .frame(height: 200)
            
            Spacer()
        }
        .frame(width: 80)
    }
}

struct TendrilAttachment: View {
    let tendril: Tendril
    let isHovered: Bool
    
    var body: some View {
        VStack(spacing: 4) {
            Circle()
                .fill(tendril.function.color.opacity(isHovered ? 0.8 : 0.4))
                .frame(width: 12, height: 12)
                .blur(radius: isHovered ? 0 : 1)
            
            if isHovered {
                Text(tendril.function.rawValue)
                    .font(.system(size: 10))
                    .foregroundColor(tendril.function.color)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.black.opacity(0.8))
                    )
            }
        }
    }
}

struct CreatureBody: View {
    let creature: ShadowCreature
    let phase: CGFloat
    let hoveredTendril: UUID?
    
    var body: some View {
        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            
            // Core shadow mass
            let corePath = Path(ellipseIn: CGRect(
                x: center.x - 100,
                y: center.y - 80,
                width: 200,
                height: 160
            ))
            
            context.fill(corePath, with: .color(.black.opacity(0.8 - creature.health * 0.3)))
            
            // Pulsing organs
            for (index, tendril) in creature.tendrils.enumerated() {
                let organX = center.x + sin(CGFloat(index) * 0.8) * 60
                let organY = center.y + cos(CGFloat(index) * 0.8) * 40
                let organSize = 20 + sin(phase + CGFloat(index)) * 5
                
                let organPath = Path(ellipseIn: CGRect(
                    x: organX - organSize / 2,
                    y: organY - organSize / 2,
                    width: organSize,
                    height: organSize
                ))
                
                context.fill(organPath, with: .color(tendril.function.color.opacity(0.3 + sin(phase * 2) * 0.1)))
            }
        }
    }
}

struct SleepChallenge: Identifiable {
    let id = UUID()
    let name: String
    let description: String
    let targetFunction: CognitiveFunction
    let duration: Int // minutes
    
    static let available = [
        SleepChallenge(name: "Meditation Shield", description: "10 minute guided sleep meditation", targetFunction: .emotion, duration: 10),
        SleepChallenge(name: "Dream Journal", description: "Record morning dreams", targetFunction: .creativity, duration: 5),
        SleepChallenge(name: "Sleep Hygiene", description: "No screens 1 hour before bed", targetFunction: .focus, duration: 60)
    ]
}

struct ChallengeCard: View {
    let challenge: SleepChallenge
    let isActive: Bool
    let onActivate: () -> Void
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: isActive ? "shield.fill" : "shield")
                    .foregroundColor(challenge.targetFunction.color)
                Text(challenge.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
            }
            
            Text(challenge.description)
                .font(.system(size: 11))
                .foregroundColor(Color(white: 0.6))
            
            Button(action: onActivate) {
                Text(isActive ? "Active" : "Start")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(isActive ? .black : .white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
                    .background(
                        RoundedRectangle(cornerRadius: 4)
                            .fill(isActive ? challenge.targetFunction.color : Color(white: 0.2))
                    )
            }
            .buttonStyle(.plain)
            .disabled(isActive)
        }
        .padding(16)
        .frame(width: 200)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(white: 0.05))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(isActive ? challenge.targetFunction.color.opacity(0.5) : Color(white: 0.1), lineWidth: 1)
                )
        )
    }
}

struct DreamThread: Identifiable {
    let id = UUID()
    let startPoint: CGPoint
    let endPoint: CGPoint
    let color: Color
    var waveOffset: CGFloat = 0
    
    init(from tendril: Tendril) {
        startPoint = CGPoint(x: CGFloat.random(in: 100...1340), y: 400)
        endPoint = CGPoint(x: CGFloat.random(in: 100...1340), y: 60)
        color = tendril.function.color
    }
}

struct LuminousThread: View {
    let thread: DreamThread
    let phase: CGFloat
    
    var body: some View {
        Path { path in
            path.move(to: thread.startPoint)
            
            let steps = 20
            for i in 0...steps {
                let t = CGFloat(i) / CGFloat(steps)
                let x = thread.startPoint.x + (thread.endPoint.x - thread.startPoint.x) * t
                let y = thread.startPoint.y + (thread.endPoint.y - thread.startPoint.y) * t
                let wave = sin(t * .pi * 3 + thread.waveOffset) * 20
                path.addLine(to: CGPoint(x: x + wave, y: y))
            }
        }
        .stroke(
            LinearGradient(
                colors: [
                    thread.color.opacity(0.1),
                    thread.color.opacity(0.8),
                    thread.color.opacity(0.1)
                ],
                startPoint: .leading,
                endPoint: .trailing
            ),
            lineWidth: 2
        )
        .blur(radius: 0.5)
    }
}