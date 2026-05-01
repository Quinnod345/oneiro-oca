struct ContentView: View {
    @State private var auctions: [Auction] = Auction.sampleData
    @State private var selectedAuction: Auction?
    @State private var bidAmount: String = ""
    @State private var showBidConfirmation = false
    @State private var userBids: [Bid] = []
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    HeaderSection()
                    
                    if !userBids.isEmpty {
                        ActiveBidsSection(bids: userBids)
                    }
                    
                    AuctionListSection(
                        auctions: auctions,
                        selectedAuction: $selectedAuction,
                        bidAmount: $bidAmount,
                        showBidConfirmation: $showBidConfirmation,
                        userBids: $userBids
                    )
                }
                .padding()
            }
            .background(Color(UIColor.systemGroupedBackground))
            .navigationTitle("Auctions")
            .navigationBarTitleDisplayMode(.large)
        }
        .alert("Bid Placed Successfully", isPresented: $showBidConfirmation) {
            Button("OK") {
                bidAmount = ""
                selectedAuction = nil
            }
        } message: {
            Text("Your bid has been recorded. You'll be notified if you're outbid.")
        }
    }
}

struct HeaderSection: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Welcome back")
                .font(.headline)
                .foregroundColor(.secondary)
            
            Text("Find and bid on items")
                .font(.largeTitle)
                .fontWeight(.bold)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom)
    }
}

struct ActiveBidsSection: View {
    let bids: [Bid]
    
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Your Active Bids")
                .font(.headline)
            
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(bids) { bid in
                        ActiveBidCard(bid: bid)
                    }
                }
            }
        }
    }
}

struct ActiveBidCard: View {
    let bid: Bid
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(bid.itemName)
                .font(.subheadline)
                .fontWeight(.medium)
            
            Text("$\(bid.amount, specifier: "%.2f")")
                .font(.title3)
                .fontWeight(.semibold)
            
            Label(bid.status.rawValue, systemImage: bid.status.icon)
                .font(.caption)
                .foregroundColor(bid.status.color)
        }
        .padding()
        .frame(width: 160)
        .background(Color(UIColor.secondarySystemGroupedBackground))
        .cornerRadius(12)
    }
}

struct AuctionListSection: View {
    let auctions: [Auction]
    @Binding var selectedAuction: Auction?
    @Binding var bidAmount: String
    @Binding var showBidConfirmation: Bool
    @Binding var userBids: [Bid]
    
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Current Auctions")
                .font(.headline)
            
            ForEach(auctions) { auction in
                AuctionCard(
                    auction: auction,
                    isExpanded: selectedAuction?.id == auction.id,
                    bidAmount: $bidAmount,
                    onTap: {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                            selectedAuction = selectedAuction?.id == auction.id ? nil : auction
                        }
                    },
                    onBid: {
                        placeBid(for: auction)
                    }
                )
            }
        }
    }
    
    func placeBid(for auction: Auction) {
        guard let amount = Double(bidAmount), amount > auction.currentBid else { return }
        
        let newBid = Bid(
            id: UUID(),
            itemName: auction.title,
            amount: amount,
            status: .winning,
            auctionId: auction.id
        )
        
        userBids.append(newBid)
        showBidConfirmation = true
    }
}

struct AuctionCard: View {
    let auction: Auction
    let isExpanded: Bool
    @Binding var bidAmount: String
    let onTap: () -> Void
    let onBid: () -> Void
    
    var body: some View {
        VStack(spacing: 0) {
            Button(action: onTap) {
                HStack(spacing: 16) {
                    Image(systemName: auction.category.icon)
                        .font(.title2)
                        .foregroundColor(auction.category.color)
                        .frame(width: 48, height: 48)
                        .background(auction.category.color.opacity(0.1))
                        .cornerRadius(8)
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text(auction.title)
                            .font(.headline)
                            .foregroundColor(.primary)
                        
                        Text(auction.seller)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        
                        HStack {
                            Label("$\(auction.currentBid, specifier: "%.2f")", systemImage: "dollarsign.circle")
                                .font(.subheadline)
                                .fontWeight(.medium)
                            
                            Spacer()
                            
                            TimeRemainingView(endTime: auction.endTime)
                        }
                    }
                    
                    Spacer()
                    
                    Image(systemName: "chevron.down")
                        .foregroundColor(.secondary)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                }
                .padding()
            }
            .buttonStyle(.plain)
            
            if isExpanded {
                VStack(alignment: .leading, spacing: 16) {
                    Divider()
                    
                    Text(auction.description)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    
                    HStack(spacing: 12) {
                        TextField("Enter bid amount", text: $bidAmount)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.decimalPad)
                        
                        Button(action: onBid) {
                            Text("Place Bid")
                                .fontWeight(.medium)
                                .foregroundColor(.white)
                                .padding(.horizontal, 20)
                                .padding(.vertical, 8)
                                .background(Color.blue)
                                .cornerRadius(8)
                        }
                        .disabled(Double(bidAmount) ?? 0 <= auction.currentBid)
                    }
                    
                    HStack {
                        Label("\(auction.bidCount) bids", systemImage: "person.2")
                        Spacer()
                        Label("Min increment: $\(auction.minIncrement, specifier: "%.2f")", systemImage: "arrow.up.circle")
                    }
                    .font(.caption)
                    .foregroundColor(.secondary)
                }
                .padding()
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .background(Color(UIColor.secondarySystemGroupedBackground))
        .cornerRadius(12)
        .shadow(color: Color.black.opacity(0.05), radius: 2, x: 0, y: 1)
    }
}

struct TimeRemainingView: View {
    let endTime: Date
    @State private var timeRemaining: String = ""
    
    let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    
    var body: some View {
        Label(timeRemaining, systemImage: "clock")
            .font(.caption)
            .foregroundColor(.orange)
            .onReceive(timer) { _ in
                updateTimeRemaining()
            }
            .onAppear {
                updateTimeRemaining()
            }
    }
    
    func updateTimeRemaining() {
        let remaining = endTime.timeIntervalSinceNow
        if remaining > 0 {
            let hours = Int(remaining) / 3600
            let minutes = Int(remaining) % 3600 / 60
            timeRemaining = "\(hours)h \(minutes)m"
        } else {
            timeRemaining = "Ended"
        }
    }
}

struct Auction: Identifiable {
    let id = UUID()
    let title: String
    let description: String
    let seller: String
    let currentBid: Double
    let minIncrement: Double
    let bidCount: Int
    let endTime: Date
    let category: Category
    
    enum Category {
        case electronics, collectibles, art, furniture
        
        var icon: String {
            switch self {
            case .electronics: return "laptopcomputer"
            case .collectibles: return "star"
            case .art: return "paintbrush"
            case .furniture: return "sofa"
            }
        }
        
        var color: Color {
            switch self {
            case .electronics: return .blue
            case .collectibles: return .purple
            case .art: return .orange
            case .furniture: return .green
            }
        }
    }
    
    static let sampleData: [Auction] = [
        Auction(
            title: "MacBook Pro 14\"",
            description: "2021 model, M1 Pro chip, 16GB RAM, 512GB SSD. Excellent condition with original box and accessories.",
            seller: "TechStore",
            currentBid: 1250.00,
            minIncrement: 25.00,
            bidCount: 8,
            endTime: Date().addingTimeInterval(7200),
            category: .electronics
        ),
        Auction(
            title: "Vintage Baseball Cards",
            description: "Complete 1987 Topps set in mint condition. Includes rookie cards and rare inserts.",
            seller: "CardCollector92",
            currentBid: 450.00,
            minIncrement: 10.00,
            bidCount: 12,
            endTime: Date().addingTimeInterval(14400),
            category: .collectibles
        ),
        Auction(
            title: "Original Oil Painting",
            description: "Beautiful landscape painting by local artist. 24x36 inches, framed. Signed and dated.",
            seller: "ArtGalleryNYC",
            currentBid: 800.00,
            minIncrement: 50.00,
            bidCount: 5,
            endTime: Date().addingTimeInterval(21600),
            category: .art
        )
    ]
}

struct Bid: Identifiable {
    let id: UUID
    let itemName: String
    let amount: Double
    let status: Status
    let auctionId: UUID
    
    enum Status: String {
        case winning = "Winning"
        case outbid = "Outbid"
        case won = "Won"
        
        var icon: String {
            switch self {
            case .winning: return "checkmark.circle"
            case .outbid: return "exclamationmark.circle"
            case .won: return "trophy"
            }
        }
        
        var color: Color {
            switch self {
            case .winning: return .green
            case .outbid: return .orange
            case .won: return .blue
            }
        }
    }
}