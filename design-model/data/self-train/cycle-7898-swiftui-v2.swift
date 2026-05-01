struct ContentView: View {
    @State private var memories: [MemoryJar] = [
        MemoryJar(title: "Last voicemail to mother", device: "Nokia 3310", timestamp: Date(timeIntervalSince1970: 946684800), integrity: 0.72, basePrice: 45, currentBid: 127),
        MemoryJar(title: "Unfinished love letter", device: "Palm Pilot", timestamp: Date(timeIntervalSince1970: 1041379200), integrity: 0.34, basePrice: 89, currentBid: 234),
        MemoryJar(title: "Child's first recording", device: "iPod Classic", timestamp: Date(timeIntervalSince1970: 1136073600), integrity: 0.91, basePrice: 156, currentBid: 891),
        MemoryJar(title: "Deleted family photos", device: "Motorola RAZR", timestamp: Date(timeIntervalSince1970: 1167609600), integrity: 0.15, basePrice: 234, currentBid: 445),
        MemoryJar(title: "Voice memo: 'Remember this moment'", device: "BlackBerry Pearl", timestamp: Date(timeIntervalSince1970: 1199145600), integrity: 0.56, basePrice: 67, currentBid: 398)
    ]
    
    @State private var selectedMemory: UUID?
    @State private var bidAmount: String = ""
    @State private var hoveredMemory: UUID?
    
    let bidTimer = Timer.publish(every: 3.5, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            Color(red: 0.08, green: 0.08, blue: 0.1)
                .ignoresSafeArea()
            
            VStack(spacing: 0) {
                headerSection
                
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 24) {
                        ForEach($memories) { $memory in
                            memoryCard(memory: $memory)
                                .frame(width: 280, height: 380)
                        }
                    }
                    .padding(.horizontal, 40)
                }
                .frame(height: 420)
                
                bidSection
            }
        }
        .onReceive(bidTimer) { _ in
            simulateRandomBid()
        }
    }
    
    var headerSection: some View {
        VStack(spacing: 8) {
            Text("MEMORY VAULT")
                .font(.system(size: 28, weight: .medium, design: .monospaced))
                .foregroundColor(.white)
                .tracking(4)
            
            Text("Digital Artifacts Exchange")
                .font(.system(size: 14, weight: .regular, design: .monospaced))
                .foregroundColor(Color(red: 0.6, green: 0.6, blue: 0.65))
        }
        .padding(.vertical, 32)
    }
    
    func memoryCard(memory: Binding<MemoryJar>) -> some View {
        VStack(spacing: 0) {
            // Header with integrity
            HStack {
                Circle()
                    .fill(integrityColor(memory.wrappedValue.integrity))
                    .frame(width: 8, height: 8)
                
                Text("\(Int(memory.wrappedValue.integrity * 100))% INTACT")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundColor(integrityColor(memory.wrappedValue.integrity))
                
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            .background(Color(red: 0.12, green: 0.12, blue: 0.15))
            
            // Main content
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(memory.wrappedValue.title)
                        .font(.system(size: 18, weight: .medium, design: .default))
                        .foregroundColor(.white)
                        .lineLimit(2)
                    
                    Text(memory.wrappedValue.device)
                        .font(.system(size: 12, weight: .regular, design: .monospaced))
                        .foregroundColor(Color(red: 0.5, green: 0.5, blue: 0.55))
                }
                
                VStack(alignment: .leading, spacing: 4) {
                    Text("TIMESTAMP")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundColor(Color(red: 0.4, green: 0.4, blue: 0.45))
                    
                    Text(formatTimestamp(memory.wrappedValue.timestamp))
                        .font(.system(size: 12, weight: .regular, design: .monospaced))
                        .foregroundColor(Color(red: 0.7, green: 0.7, blue: 0.75))
                }
                
                Spacer()
                
                // Bid information
                VStack(spacing: 12) {
                    HStack {
                        Text("CURRENT BID")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundColor(Color(red: 0.4, green: 0.4, blue: 0.45))
                        Spacer()
                    }
                    
                    HStack(alignment: .bottom, spacing: 4) {
                        Text("¢")
                            .font(.system(size: 16, weight: .regular, design: .monospaced))
                            .foregroundColor(Color(red: 0.3, green: 0.8, blue: 0.5))
                        
                        Text("\(memory.wrappedValue.currentBid)")
                            .font(.system(size: 28, weight: .bold, design: .monospaced))
                            .foregroundColor(Color(red: 0.3, green: 0.8, blue: 0.5))
                        
                        Spacer()
                        
                        if memory.wrappedValue.currentBid > memory.wrappedValue.basePrice * 2 {
                            Image(systemName: "arrow.up")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(Color(red: 0.3, green: 0.8, blue: 0.5))
                        }
                    }
                }
                
                Button(action: {
                    selectedMemory = memory.wrappedValue.id
                }) {
                    Text("PLACE BID")
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundColor(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Color(red: 0.9, green: 0.9, blue: 0.92))
                }
            }
            .padding(20)
            .frame(maxHeight: .infinity)
            .background(Color(red: 0.15, green: 0.15, blue: 0.18))
        }
        .background(Color(red: 0.15, green: 0.15, blue: 0.18))
        .overlay(
            RoundedRectangle(cornerRadius: 0)
                .stroke(selectedMemory == memory.wrappedValue.id ? Color(red: 0.3, green: 0.8, blue: 0.5) : Color(red: 0.2, green: 0.2, blue: 0.25), lineWidth: 1)
        )
        .scaleEffect(hoveredMemory == memory.wrappedValue.id ? 1.02 : 1.0)
        .onHover { hovering in
            withAnimation(.easeOut(duration: 0.2)) {
                hoveredMemory = hovering ? memory.wrappedValue.id : nil
            }
        }
    }
    
    var bidSection: some View {
        HStack(spacing: 24) {
            if let selected = memories.first(where: { $0.id == selectedMemory }) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("BIDDING ON")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundColor(Color(red: 0.4, green: 0.4, blue: 0.45))
                    
                    Text(selected.title)
                        .font(.system(size: 14, weight: .medium, design: .default))
                        .foregroundColor(.white)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                
                HStack(spacing: 12) {
                    TextField("Amount", text: $bidAmount)
                        .font(.system(size: 16, weight: .regular, design: .monospaced))
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .frame(width: 120)
                        .background(Color(red: 0.12, green: 0.12, blue: 0.15))
                        .overlay(
                            RoundedRectangle(cornerRadius: 0)
                                .stroke(Color(red: 0.2, green: 0.2, blue: 0.25), lineWidth: 1)
                        )
                    
                    Button(action: placeBid) {
                        Text("CONFIRM")
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .foregroundColor(.black)
                            .padding(.horizontal, 24)
                            .padding(.vertical, 12)
                            .background(Color(red: 0.3, green: 0.8, blue: 0.5))
                    }
                }
            } else {
                Text("SELECT A MEMORY TO BID")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundColor(Color(red: 0.4, green: 0.4, blue: 0.45))
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(Color(red: 0.1, green: 0.1, blue: 0.12))
    }
    
    func integrityColor(_ integrity: Double) -> Color {
        switch integrity {
        case 0.7...1.0:
            return Color(red: 0.3, green: 0.8, blue: 0.5)
        case 0.4..<0.7:
            return Color(red: 0.9, green: 0.7, blue: 0.3)
        default:
            return Color(red: 0.9, green: 0.3, blue: 0.3)
        }
    }
    
    func formatTimestamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy.MM.dd"
        return formatter.string(from: date)
    }
    
    func placeBid() {
        guard let amount = Int(bidAmount),
              let index = memories.firstIndex(where: { $0.id == selectedMemory }) else { return }
        
        if amount > memories[index].currentBid {
            withAnimation(.easeOut(duration: 0.3)) {
                memories[index].currentBid = amount
            }
        }
        
        bidAmount = ""
        selectedMemory = nil
    }
    
    func simulateRandomBid() {
        let index = Int.random(in: 0..<memories.count)
        let increase = Int.random(in: 10...50)
        
        withAnimation(.easeOut(duration: 0.3)) {
            memories[index].currentBid += increase
        }
    }
}

struct MemoryJar: Identifiable {
    let id = UUID()
    let title: String
    let device: String
    let timestamp: Date
    let integrity: Double
    let basePrice: Int
    var currentBid: Int
}

struct BidEntry: Identifiable {
    let id = UUID()
    let memoryId: UUID
    let amount: Int
    let timestamp: Date
}