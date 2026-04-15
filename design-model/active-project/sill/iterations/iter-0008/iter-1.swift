struct ContentView: View {
    @State private var items: [ShelfItem] = [
        ShelfItem(title: "Project Proposal.pdf", type: .file, addedDate: Date().addingTimeInterval(-60 * 60 * 2)),
        ShelfItem(title: "design-inspiration.com", type: .url, addedDate: Date().addingTimeInterval(-60 * 60 * 24 * 3)),
        ShelfItem(title: "Meeting notes draft", type: .text, addedDate: Date().addingTimeInterval(-60 * 60 * 24 * 8)),
        ShelfItem(title: "client@studio.com", type: .email, addedDate: Date().addingTimeInterval(-60 * 60 * 24 * 12))
    ]
    
    private let maxSlots: Int = 8
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                VisualEffectView(material: .windowBackground, blendingMode: .behindWindow)
                    .ignoresSafeArea()
                
                VStack(spacing: 0) {
                    HStack {
                        Text("Workbench")
                            .font(.largeTitle)
                            .fontWeight(.medium)
                            .foregroundColor(.primary)
                        
                        Spacer()
                        
                        Button(action: {}) {
                            Image(systemName: "plus")
                                .font(.title2)
                                .foregroundColor(.accentColor)
                        }
                        .buttonStyle(.borderless)
                        .controlSize(.large)
                    }
                    .padding(.horizontal, 32)
                    .padding(.top, 24)
                    .padding(.bottom, 20)
                    
                    shelfPanel
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(.horizontal, 32)
                        .padding(.bottom, 32)
                }
            }
        }
        .frame(width: 1440, height: 900)
    }
    
    private var shelfPanel: some View {
        ZStack {
            VisualEffectView(material: .contentBackground, blendingMode: .withinWindow)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .shadow(color: .black.opacity(0.1), radius: 8, x: 0, y: 4)
            
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: 4), spacing: 20) {
                ForEach(0..<maxSlots, id: \.self) { index in
                    if index < items.count {
                        itemView(for: items[index])
                    } else {
                        emptySlotView
                    }
                }
            }
            .padding(24)
        }
    }
    
    private func itemView(for item: ShelfItem) -> some View {
        let ageInDays = Calendar.current.dateComponents([.day], from: item.addedDate, to: Date()).day ?? 0
        let ageInHours = Calendar.current.dateComponents([.hour], from: item.addedDate, to: Date()).hour ?? 0
        
        let isRecent = ageInHours <= 24
        let isOld = ageInDays >= 7
        
        return VStack(spacing: 8) {
            ZStack {
                VisualEffectView(material: .menu, blendingMode: .withinWindow)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .frame(height: 100)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(.quaternary, lineWidth: 0.5)
                    )
                
                if isRecent {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.accentColor, lineWidth: 2)
                        .frame(height: 100)
                }
                
                VStack(spacing: 6) {
                    Image(systemName: item.type.iconName)
                        .font(.title2)
                        .fontWeight(.medium)
                        .foregroundColor(isOld ? .secondary : .accentColor)
                    
                    Text(item.type.displayName)
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.secondary)
                }
            }
            
            Text(item.title)
                .font(.body)
                .fontWeight(.medium)
                .foregroundColor(isOld ? .secondary : .primary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            
            Text(formatDate(item.addedDate))
                .font(.caption2)
                .foregroundColor(.tertiary)
        }
        .opacity(isOld ? 0.6 : 1.0)
    }
    
    private var emptySlotView: some View {
        VStack(spacing: 8) {
            ZStack {
                VisualEffectView(material: .menu, blendingMode: .withinWindow)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .frame(height: 100)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(.quaternary, lineWidth: 0.5, lineCap: .round, dash: [3, 3])
                    )
                
                Image(systemName: "plus")
                    .font(.title3)
                    .foregroundColor(.tertiary)
            }
            
            Text("Empty")
                .font(.body)
                .fontWeight(.medium)
                .foregroundColor(.tertiary)
            
            Text("")
                .font(.caption2)
        }
    }
    
    private func formatDate(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

struct ShelfItem: Identifiable {
    let id = UUID()
    let title: String
    let type: ItemType
    let addedDate: Date
    
    enum ItemType: CaseIterable {
        case file, url, text, email
        
        var iconName: String {
            switch self {
            case .file: return "doc.fill"
            case .url: return "link"
            case .text: return "text.alignleft"
            case .email: return "envelope.fill"
            }
        }
        
        var displayName: String {
            switch self {
            case .file: return "Document"
            case .url: return "Link"
            case .text: return "Note"
            case .email: return "Email"
            }
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