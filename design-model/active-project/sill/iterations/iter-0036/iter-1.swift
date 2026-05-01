struct ContentView: View {
    @State private var items: [TimeDecayItem] = []
    @State private var animationPhase: CGFloat = 0
    @State private var clearingItems: Set<UUID> = []
    
    private let pulseTimer = Timer.publish(every: 0.016, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
                .ignoresSafeArea()
            
            VStack(spacing: 0) {
                HStack {
                    Text("Memory Shelf")
                        .font(.system(size: 17, weight: .semibold, design: .default))
                        .foregroundStyle(.primary)
                    
                    Spacer()
                    
                    Text("\(items.count)/8")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: 4))
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
                
                ZStack {
                    VisualEffectView(material: .hudWindow, blendingMode: .withinWindow)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: 4), spacing: 16) {
                        ForEach(items) { item in
                            itemView(for: item)
                        }
                        
                        ForEach(0..<(8 - items.count), id: \.self) { _ in
                            emptySlot
                        }
                    }
                    .padding(20)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 20)
                
                Spacer()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            setupSampleData()
        }
        .onReceive(pulseTimer) { _ in
            withAnimation(.linear(duration: 0.016)) {
                animationPhase += 0.1
            }
        }
        .gesture(
            DragGesture(minimumDistance: 100)
                .onEnded { gesture in
                    if gesture.translation.x < -200 && abs(gesture.translation.y) < 50 {
                        clearAgedItems()
                        NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .now)
                    }
                }
        )
    }
    
    private func itemView(for item: TimeDecayItem) -> some View {
        let pulseScale = item.shouldPulse ? 1.0 + sin(animationPhase * 0.5) * 0.05 : 1.0
        let pulseOpacity = item.shouldPulse ? 0.8 + sin(animationPhase * 0.3) * 0.2 : 1.0
        
        return ZStack {
            VisualEffectView(material: .menu, blendingMode: .withinWindow)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            
            VStack(spacing: 6) {
                Text(item.content)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.primary)
                    .lineLimit(3)
                    .multilineTextAlignment(.center)
                
                Text(formatAge(item.ageInDays))
                    .font(.system(size: 11, weight: .regular, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
            .padding(8)
        }
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(item.borderColor.opacity(pulseOpacity), lineWidth: item.ageInDays <= 3 ? 1.5 : 0.5)
        )
        .opacity(clearingItems.contains(item.id) ? 0 : item.opacity)
        .scaleEffect(clearingItems.contains(item.id) ? 0.1 : pulseScale)
        .rotationEffect(clearingItems.contains(item.id) ? .degrees(Double.random(in: -180...180)) : .degrees(0))
        .animation(.interpolatingSpring(stiffness: 300, damping: 30), value: clearingItems.contains(item.id))
        .frame(height: 90)
    }
    
    private var emptySlot: some View {
        RoundedRectangle(cornerRadius: 8)
            .stroke(Color(.separatorColor), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
            .frame(height: 90)
            .overlay(
                Image(systemName: "plus.circle")
                    .font(.system(size: 16, weight: .light))
                    .foregroundStyle(.quaternary)
            )
    }
    
    private func formatAge(_ days: Double) -> String {
        if days < 1 {
            let hours = Int(days * 24)
            return "\(hours)h"
        } else {
            return "\(Int(days))d"
        }
    }
    
    private func setupSampleData() {
        let now = Date()
        items = [
            TimeDecayItem(content: "Important meeting notes", createdAt: now.addingTimeInterval(-3600)),
            TimeDecayItem(content: "Project deadline", createdAt: now.addingTimeInterval(-86400 * 2)),
            TimeDecayItem(content: "Call mom", createdAt: now.addingTimeInterval(-86400 * 5)),
            TimeDecayItem(content: "Buy groceries", createdAt: now.addingTimeInterval(-86400 * 10)),
            TimeDecayItem(content: "Review documents", createdAt: now.addingTimeInterval(-1800))
        ]
    }
    
    private func clearAgedItems() {
        let itemsToRemove = items.filter { $0.ageInDays > 7 }
        
        withAnimation(.easeInOut(duration: 0.5)) {
            for item in itemsToRemove {
                clearingItems.insert(item.id)
            }
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            items.removeAll { itemsToRemove.contains($0) }
            clearingItems.removeAll()
        }
    }
}

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = blendingMode
        view.state = .active
        return view
    }
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}