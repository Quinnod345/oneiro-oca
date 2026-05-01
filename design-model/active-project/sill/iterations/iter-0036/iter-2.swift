struct ContentView: View {
    @State private var items: [TimeDecayItem] = []
    @State private var clearingItems: Set<UUID> = []
    @State private var pulsePhase: Double = 0
    
    var body: some View {
        ZStack {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
                .ignoresSafeArea()
            
            VStack(spacing: 0) {
                HStack {
                    Text("Memory Shelf")
                        .font(.system(size: 19, weight: .semibold, design: .default))
                        .foregroundStyle(.primary)
                    
                    Spacer()
                    
                    Text("\(items.count)/8")
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
                }
                .padding(.horizontal, 24)
                .padding(.top, 24)
                
                ZStack {
                    VisualEffectView(material: .hudWindow, blendingMode: .withinWindow)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .shadow(color: .black.opacity(0.1), radius: 20, x: 0, y: 10)
                    
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 20), count: 4), spacing: 20) {
                        ForEach(items) { item in
                            itemView(for: item)
                        }
                        
                        ForEach(0..<(8 - items.count), id: \.self) { _ in
                            emptySlot
                        }
                    }
                    .padding(24)
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 24)
                
                Spacer()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            setupSampleData()
            startPulseAnimation()
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
        let pulseScale = item.shouldPulse ? 1.0 + sin(pulsePhase) * 0.03 : 1.0
        let decayBlur = max(0, (item.ageInDays - 3) * 0.5)
        let gradientOpacity = min(0.7, item.ageInDays / 10.0)
        
        return ZStack {
            VisualEffectView(material: .ultraThinMaterial, blendingMode: .withinWindow)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            
            LinearGradient(
                colors: [.clear, item.borderColor.opacity(gradientOpacity)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .clipShape(RoundedRectangle(cornerRadius: 12))
            
            VStack(spacing: 8) {
                Text(item.content)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.primary)
                    .lineLimit(3)
                    .multilineTextAlignment(.center)
                    .blur(radius: decayBlur)
                
                HStack {
                    Circle()
                        .fill(item.borderColor)
                        .frame(width: 6, height: 6)
                        .opacity(item.shouldPulse ? 0.6 + sin(pulsePhase) * 0.4 : 0.8)
                    
                    Text(formatAge(item.ageInDays))
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(12)
        }
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(
                    LinearGradient(
                        colors: [item.borderColor, item.borderColor.opacity(0.3)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: item.shouldPulse ? 2 : 1
                )
                .opacity(item.shouldPulse ? 0.8 + sin(pulsePhase) * 0.2 : 0.6)
        )
        .shadow(color: item.borderColor.opacity(0.3), radius: item.shouldPulse ? 8 : 4, x: 0, y: 2)
        .opacity(clearingItems.contains(item.id) ? 0 : item.opacity)
        .scaleEffect(clearingItems.contains(item.id) ? 0.1 : pulseScale)
        .rotationEffect(clearingItems.contains(item.id) ? .degrees(Double.random(in: -180...180)) : .degrees(0))
        .animation(.interpolatingSpring(stiffness: 300, damping: 30), value: clearingItems.contains(item.id))
        .frame(height: 110)
    }
    
    private var emptySlot: some View {
        RoundedRectangle(cornerRadius: 12)
            .stroke(Color(.separatorColor), style: StrokeStyle(lineWidth: 1, dash: [6, 6]))
            .frame(height: 110)
            .overlay(
                Image(systemName: "plus.circle")
                    .font(.system(size: 18, weight: .light))
                    .foregroundStyle(.quaternary)
            )
    }
    
    private func startPulseAnimation() {
        withAnimation(.easeInOut(duration: 2).repeatForever(autoreverses: true)) {
            pulsePhase = .pi
        }
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