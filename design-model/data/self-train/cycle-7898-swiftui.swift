struct ContentView: View {
    @State private var memories: [MemoryJar] = [
        MemoryJar(title: "Last voicemail to mother", device: "Nokia 3310", timestamp: Date(timeIntervalSince1970: 946684800), integrity: 0.72, basePrice: 45, currentBid: 127),
        MemoryJar(title: "Unfinished love letter", device: "Palm Pilot", timestamp: Date(timeIntervalSince1970: 1041379200), integrity: 0.34, basePrice: 89, currentBid: 234),
        MemoryJar(title: "Child's first recording", device: "iPod Classic", timestamp: Date(timeIntervalSince1970: 1136073600), integrity: 0.91, basePrice: 156, currentBid: 891),
        MemoryJar(title: "Deleted family photos", device: "Motorola RAZR", timestamp: Date(timeIntervalSince1970: 1167609600), integrity: 0.15, basePrice: 234, currentBid: 445),
        MemoryJar(title: "Voice memo: 'Remember this moment'", device: "BlackBerry Pearl", timestamp: Date(timeIntervalSince1970: 1199145600), integrity: 0.56, basePrice: 67, currentBid: 398)
    ]
    
    @State private var bidHistory: [BidEntry] = []
    @State private var tickerOffset: CGFloat = 0
    @State private var selectedMemory: UUID?
    @State private var bidAmount: String = ""
    @State private var hoveredMemory: UUID?
    @State private var downloadProgress: Double = 0
    @State private var crystallizingMemory: UUID?
    
    let tickerTimer = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()
    let bidPulseTimer = Timer.publish(every: 2.5, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            Color(red: 0.06, green: 0.05, blue: 0.08)
                .ignoresSafeArea()
            
            VStack(spacing: 0) {
                headerSection
                
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 80) {
                        ForEach($memories) { $memory in
                            memoryJarView(memory: $memory)
                                .frame(width: 280, height: 500)
                        }
                    }
                    .padding(.horizontal, 100)
                }
                .frame(height: 550)
                
                bidControlSection
            }
            
            if crystallizingMemory != nil {
                crystallizationOverlay
            }
        }
        .onReceive(tickerTimer) { _ in
            withAnimation(.linear(duration: 0.05)) {
                tickerOffset -= 2
                if tickerOffset < -2000 {
                    tickerOffset = 0
                }
            }
        }
        .onReceive(bidPulseTimer) { _ in
            simulateRandomBid()
        }
    }
    
    var headerSection: some View {
        VStack(spacing: 16) {
            Text("MEMORY AUCTION HOUSE")
                .font(.system(size: 42, weight: .thin, design: .serif))
                .foregroundColor(Color(red: 0.9, green: 0.85, blue: 0.7))
                .kerning(8)
            
            Text("Artifacts from the Digital Departed")
                .font(.system(size: 16, weight: .light, design: .serif))
                .foregroundColor(Color(red: 0.6, green: 0.55, blue: 0.5))
                .italic()
        }
        .padding(.vertical, 40)
    }
    
    func memoryJarView(memory: Binding<MemoryJar>) -> some View {
        ZStack {
            // Victorian ornate frame
            RoundedRectangle(cornerRadius: 20)
                .fill(Color(red: 0.15, green: 0.12, blue: 0.1))
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.7, green: 0.6, blue: 0.4),
                                    Color(red: 0.5, green: 0.4, blue: 0.3)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 3
                        )
                )
            
            VStack(spacing: 0) {
                // Bell jar container
                ZStack {
                    // Glass effect with depth blur
                    bellJarGlass(memory: memory.wrappedValue)
                        .blur(radius: max(0, 20 - (memory.wrappedValue.currentBid / 50)))
                    
                    // Memory content
                    VStack(spacing: 20) {
                        memoryTitle(memory: memory.wrappedValue)
                        
                        deviceTag(memory: memory.wrappedValue)
                        
                        integrityIndicator(memory: memory.wrappedValue)
                    }
                    .padding(.horizontal, 30)
                    .opacity(min(1, memory.wrappedValue.currentBid / 200))
                    
                    // Ticker tape wrapping
                    tickerTapeWrap(memory: memory.wrappedValue)
                    
                    // Crack overlay
                    if memory.wrappedValue.isCracking {
                        crackPattern()
                            .opacity(memory.wrappedValue.bidIntensity)
                    }
                }
                .frame(height: 350)
                
                // Bid information
                bidInfoSection(memory: memory)
            }
            .padding(20)
        }
        .scaleEffect(hoveredMemory == memory.id ? 1.05 : 1.0)
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.3)) {
                hoveredMemory = hovering ? memory.id : nil
            }
        }
    }
    
    func bellJarGlass(memory: MemoryJar) -> some View {
        Ellipse()
            .fill(
                RadialGradient(
                    colors: [
                        Color(red: 0.9, green: 0.88, blue: 0.85).opacity(0.2),
                        Color(red: 0.7, green: 0.68, blue: 0.65).opacity(0.1)
                    ],
                    center: .center,
                    startRadius: 50,
                    endRadius: 150
                )
            )
            .overlay(
                Ellipse()
                    .stroke(Color.white.opacity(0.3), lineWidth: 1)
            )
    }
    
    func memoryTitle(memory: MemoryJar) -> some View {
        Text(memory.title)
            .font(.system(size: 18, weight: .light, design: .serif))
            .foregroundColor(Color(red: 0.9, green: 0.85, blue: 0.7))
            .multilineTextAlignment(.center)
            .lineLimit(3)
    }
    
    func deviceTag(memory: MemoryJar) -> some View {
        HStack {
            Image(systemName: "desktopcomputer")
                .font(.system(size: 12))
            Text(memory.device)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
        }
        .foregroundColor(Color(red: 0.6, green: 0.55, blue: 0.5))
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(red: 0.2, green: 0.18, blue: 0.15).opacity(0.6))
        )
    }
    
    func integrityIndicator(memory: MemoryJar) -> some View {
        VStack(spacing: 8) {
            Text("INTEGRITY")
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundColor(Color(red: 0.5, green: 0.45, blue: 0.4))
            
            ZStack {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(red: 0.2, green: 0.18, blue: 0.15))
                    .frame(width: 120, height: 8)
                
                GeometryReader { geometry in
                    RoundedRectangle(cornerRadius: 4)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.3, green: 0.8, blue: 0.3),
                                    Color(red: 0.8, green: 0.8, blue: 0.3),
                                    Color(red: 0.8, green: 0.3, blue: 0.3)
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: geometry.size.width * memory.integrity)
                        .animation(.easeInOut(duration: 0.5), value: memory.integrity)
                }
                .frame(width: 120, height: 8)
            }
            
            Text("\(Int(memory.integrity * 100))%")
                .font(.system(size: 12, weight: .light, design: .monospaced))
                .foregroundColor(Color(red: 0.7, green: 0.65, blue: 0.6))
        }
    }
    
    func tickerTapeWrap(memory: MemoryJar) -> some View {
        GeometryReader { geometry in
            ZStack {
                ForEach(0..<3) { index in
                    Text(generateTickerText())
                        .font(.system(size: 10, weight: .light, design: .monospaced))
                        .foregroundColor(Color(red: 0.8, green: 0.75, blue: 0.65).opacity(0.3))
                        .offset(x: tickerOffset + CGFloat(index * 700))
                        .rotationEffect(.degrees(Double(index * 30 - 30)))
                        .offset(y: CGFloat(index * 100 - 100))
                }
            }
            .mask(
                Ellipse()
                    .frame(width: geometry.size.width * 1.2, height: geometry.size.height * 1.2)
            )
        }
    }
    
    func generateTickerText() -> String {
        return "LOT #\(Int.random(in: 1000...9999)) • AUTHENTICATED • ESTATE OF THE DEPARTED • DIGITAL ARTIFACTS • "
    }
    
    func crackPattern() -> some View {
        ZStack {
            Path { path in
                path.move(to: CGPoint(x: 50, y: 50))
                path.addLine(to: CGPoint(x: 80, y: 120))
                path.addLine(to: CGPoint(x: 60, y: 180))
                
                path.move(to: CGPoint(x: 150, y: 80))
                path.addLine(to: CGPoint(x: 120, y: 140))
                path.addLine(to: CGPoint(x: 140, y: 200))
            }
            .stroke(Color.white.opacity(0.6), lineWidth: 1)
        }
    }
    
    func bidInfoSection(memory: Binding<MemoryJar>) -> some View {
        VStack(spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("CURRENT BID")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundColor(Color(red: 0.5, green: 0.45, blue: 0.4))
                    
                    Text("$\(memory.wrappedValue.currentBid)")
                        .font(.system(size: 24, weight: .light, design: .serif))
                        .foregroundColor(Color(red: 0.9, green: 0.85, blue: 0.7))
                }
                
                Spacer()
                
                Button(action: {
                    placeBid(on: memory)
                }) {
                    Text("BID")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(Color(red: 0.1, green: 0.08, blue: 0.06))
                        .padding(.horizontal, 20)
                        .padding(.vertical, 8)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(Color(red: 0.8, green: 0.75, blue: 0.65))
                        )
                }
            }
            
            if selectedMemory == memory.id {
                HStack {
                    TextField("Amount", text: $bidAmount)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                        .frame(width: 100)
                    
                    Button("Confirm") {
                        confirmBid(on: memory)
                    }
                    .font(.system(size: 12))
                    .foregroundColor(Color.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
                    .background(Color(red: 0.3, green: 0.25, blue: 0.2))
                    .cornerRadius(4)
                }
            }
        }
        .padding(.top, 20)
    }
    
    var bidControlSection: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 20) {
                ForEach(bidHistory.suffix(10)) { bid in
                    bidHistoryEntry(bid: bid)
                }
            }
            .padding(.horizontal, 40)
        }
        .frame(height: 60)
        .background(Color(red: 0.08, green: 0.06, blue: 0.05))
    }
    
    func bidHistoryEntry(bid: BidEntry) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "gavel")
                .font(.system(size: 12))
                .foregroundColor(Color(red: 0.7, green: 0.65, blue: 0.6))
            
            Text("$\(bid.amount)")
                .font(.system(size: 14, weight: .medium, design: .monospaced))
                .foregroundColor(Color(red: 0.9, green: 0.85, blue: 0.7))
            
            Text(timeAgo(from: bid.timestamp))
                .font(.system(size: 10, weight: .light))
                .foregroundColor(Color(red: 0.5, green: 0.45, blue: 0.4))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(red: 0.12, green: 0.1, blue: 0.08))
        )
    }
    
    func timeAgo(from date: Date) -> String {
        let seconds = Int(Date().timeIntervalSince(date))
        if seconds < 60 {
            return "\(seconds)s ago"
        } else if seconds < 3600 {
            return "\(seconds / 60)m ago"
        } else {
            return "\(seconds / 3600)h ago"
        }
    }
    
    var crystallizationOverlay: some View {
        ZStack {
            Color.black.opacity(0.8)
                .ignoresSafeArea()
            
            VStack(spacing: 30) {
                Text("CRYSTALLIZING MEMORY")
                    .font(.system(size: 28, weight: .thin, design: .serif))
                    .foregroundColor(Color(red: 0.9, green: 0.85, blue: 0.7))
                    .kerning(4)
                
                ProgressView(value: downloadProgress)
                    .progressViewStyle(LinearProgressViewStyle())
                    .tint(Color(red: 0.7, green: 0.65, blue: 0.6))
                    .frame(width: 300)
                    .onAppear {
                        withAnimation(.linear(duration: 3)) {
                            downloadProgress = 1.0
                        }
                        
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3.5) {
                            crystallizingMemory = nil
                            downloadProgress = 0
                        }
                    }
                
                Text("Please wait while the memory materializes...")
                    .font(.system(size: 14, weight: .light))
                    .foregroundColor(Color(red: 0.6, green: 0.55, blue: 0.5))
                    .italic()
            }
            .padding(40)
            .background(
                RoundedRectangle(cornerRadius: 20)
                    .fill(Color(red: 0.15, green: 0.12, blue: 0.1))
                    .overlay(
                        RoundedRectangle(cornerRadius: 20)
                            .stroke(Color(red: 0.7, green: 0.6, blue: 0.4), lineWidth: 1)
                    )
            )
        }
    }
    
    func placeBid(on memory: Binding<MemoryJar>) {
        selectedMemory = memory.id
        bidAmount = String(memory.wrappedValue.currentBid + 10)
    }
    
    func confirmBid(on memory: Binding<MemoryJar>) {
        guard let amount = Int(bidAmount), amount > memory.wrappedValue.currentBid else { return }
        
        memory.wrappedValue.currentBid = amount
        memory.wrappedValue.isCracking = true
        memory.wrappedValue.bidIntensity = min(1.0, Double(amount - memory.wrappedValue.basePrice) / 500.0)
        
        let entry = BidEntry(memoryId: memory.id, amount: amount, timestamp: Date())
        bidHistory.append(entry)
        
        selectedMemory = nil
        bidAmount = ""
        
        if amount > memory.wrappedValue.basePrice * 5 {
            crystallizingMemory = memory.id
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            memory.wrappedValue.isCracking = false
        }
    }
    
    func simulateRandomBid() {
        guard memories.count > 0 else { return }
        let randomIndex = Int.random(in: 0..<memories.count)
        let increase = Int.random(in: 5...50)
        memories[randomIndex].currentBid += increase
        
        let entry = BidEntry(
            memoryId: memories[randomIndex].id,
            amount: memories[randomIndex].currentBid,
            timestamp: Date()
        )
        bidHistory.append(entry)
    }
}