struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(title: "Project Proposal.pdf", type: .file, addedDate: Date().addingTimeInterval(-60 * 60 * 2)),
        ShelfItem(title: "design-inspiration.com", type: .url, addedDate: Date().addingTimeInterval(-60 * 60 * 24 * 3)),
        ShelfItem(title: "Meeting notes draft", type: .text, addedDate: Date().addingTimeInterval(-60 * 60 * 24 * 8)),
        ShelfItem(title: "client@studio.com", type: .email, addedDate: Date().addingTimeInterval(-60 * 60 * 24 * 12))
    ]
    
    private let maxSlots: Int = 8
    private let baseWarmColor = Color(hue: 0.08, saturation: 0.35, brightness: 0.92)
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Canvas { context, size in
                    context.fill(
                        Path(CGRect(origin: .zero, size: size)),
                        with: .color(Color(hue: 0.08, saturation: 0.25, brightness: 0.88))
                    )
                    
                    let grainSpacing: CGFloat = 120
                    for x in stride(from: 0, through: size.width, by: grainSpacing) {
                        for y in stride(from: 0, through: size.height, by: grainSpacing * 0.3) {
                            let offset = (Int(y / (grainSpacing * 0.3)) % 2 == 0) ? 0 : grainSpacing * 0.5
                            let actualX = x + offset
                            
                            if actualX >= 0 && actualX <= size.width {
                                var path = Path()
                                path.move(to: CGPoint(x: actualX, y: y))
                                path.addLine(to: CGPoint(x: actualX + grainSpacing * 0.8, y: y))
                                
                                context.stroke(
                                    path,
                                    with: .color(Color(hue: 0.08, saturation: 0.4, brightness: 0.82).opacity(0.15)),
                                    lineWidth: 1.2
                                )
                            }
                        }
                    }
                }
                
                VStack(spacing: 0) {
                    HStack {
                        Text("Workbench")
                            .font(.system(size: 28, weight: .medium, design: .serif))
                            .foregroundColor(Color(hue: 0.08, saturation: 0.6, brightness: 0.3))
                        
                        Spacer()
                        
                        Button(action: {}) {
                            Image(systemName: "plus.circle.fill")
                                .font(.system(size: 22, weight: .medium))
                                .foregroundColor(Color(hue: 0.08, saturation: 0.4, brightness: 0.65))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 40)
                    .padding(.top, 32)
                    .padding(.bottom, 24)
                    
                    shelfPanel
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(.horizontal, 40)
                        .padding(.bottom, 40)
                }
            }
        }
        .frame(width: 1440, height: 900)
    }
    
    private var shelfPanel: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 16)
                .fill(Color(hue: 0.08, saturation: 0.28, brightness: 0.94))
                .shadow(color: Color(hue: 0.08, saturation: 0.3, brightness: 0.4).opacity(0.25), radius: 8, x: 0, y: 4)
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(Color(hue: 0.08, saturation: 0.35, brightness: 0.85), lineWidth: 1)
                )
            
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 20), count: 4), spacing: 24) {
                ForEach(0..<maxSlots, id: \.self) { index in
                    if index < items.count {
                        itemView(for: items[index])
                    } else {
                        emptySlotView
                    }
                }
            }
            .padding(32)
        }
    }
    
    private func itemView(for item: ShelfItem) -> some View {
        let ageInDays = Calendar.current.dateComponents([.day], from: item.addedDate, to: Date()).day ?? 0
        let ageInHours = Calendar.current.dateComponents([.hour], from: item.addedDate, to: Date()).hour ?? 0
        
        let isRecent = ageInHours <= 24
        let isOld = ageInDays >= 7
        
        let opacity: Double = isOld ? 0.35 : 1.0
        let baseHue: Double = isOld ? 0.58 : item.type.color.hue
        
        return VStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(hue: baseHue, saturation: 0.15, brightness: 0.96))
                    .frame(height: 120)
                    .shadow(color: Color.black.opacity(0.08), radius: 3, x: 0, y: 2)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color(hue: baseHue, saturation: 0.25, brightness: 0.88), lineWidth: 1)
                    )
                
                if isRecent {
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color(hue: 0.08, saturation: 0.4, brightness: 0.85), lineWidth: 2)
                        .frame(height: 120)
                        .shadow(color: Color(hue: 0.08, saturation: 0.5, brightness: 0.8).opacity(0.4), radius: 6)
                }
                
                VStack(spacing: 8) {
                    Image(systemName: item.type.iconName)
                        .font(.system(size: 32, weight: .medium))
                        .foregroundColor(Color(hue: baseHue, saturation: item.type.color.saturation, brightness: item.type.color.brightness))
                    
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color(hue: baseHue, saturation: item.type.color.saturation * 0.7, brightness: 0.95))
                        .frame(width: 60, height: 4)
                        .overlay(
                            Text(item.type.displayName.uppercased())
                                .font(.system(size: 8, weight: .semibold, design: .rounded))
                                .foregroundColor(Color(hue: baseHue, saturation: item.type.color.saturation, brightness: item.type.color.brightness * 0.8))
                                .offset(y: -12)
                        )
                }
            }
            
            Text(item.title)
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(Color(hue: 0.08, saturation: 0.4, brightness: 0.35))
                .lineLimit(2)
                .multilineTextAlignment(.center)
        }
        .opacity(opacity)
        .scaleEffect(isRecent ? 1.02 : 1.0)
        .animation(.easeInOut(duration: 0.3), value: isRecent)
    }
    
    private var emptySlotView: some View {
        VStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(hue: 0.08, saturation: 0.2, brightness: 0.86))
                .frame(height: 120)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color(hue: 0.08, saturation: 0.25, brightness: 0.82), lineWidth: 1)
                        .blendMode(.multiply)
                )
                .shadow(color: Color(hue: 0.08, saturation: 0.3, brightness: 0.6).opacity(0.3), radius: 2, x: 0, y: 1)
                .overlay(
                    Circle()
                        .stroke(Color(hue: 0.08, saturation: 0.3, brightness: 0.75), style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                        .frame(width: 40, height: 40)
                        .overlay(
                            Image(systemName: "plus")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(Color(hue: 0.08, saturation: 0.35, brightness: 0.65))
                        )
                )
            
            Text("Drop here")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(Color(hue: 0.08, saturation: 0.3, brightness: 0.55))
        }
    }
}

struct ShelfItem: Identifiable {
    let id = UUID()
    let title: String
    let type: ItemType
    let addedDate: Date
}

enum ItemType {
    case text, url, email, file
    
    var displayName: String {
        switch self {
        case .text: return "text"
        case .url: return "url"
        case .email: return "email"
        case .file: return "file"
        }
    }
    
    var iconName: String {
        switch self {
        case .text: return "doc.text"
        case .url: return "link"
        case .email: return "envelope"
        case .file: return "doc"
        }
    }
    
    var color: (hue: Double, saturation: Double, brightness: Double) {
        switch self {
        case .text: return (hue: 0.08, saturation: 0.6, brightness: 0.4)
        case .url: return (hue: 0.25, saturation: 0.4, brightness: 0.5)
        case .email: return (hue: 0.12, saturation: 0.5, brightness: 0.6)
        case .file: return (hue: 0.6, saturation: 0.25, brightness: 0.45)
        }
    }
}