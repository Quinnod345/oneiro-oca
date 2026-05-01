struct ContentView: View {
    @State private var timeLayers: [TimeLayer] = []
    @State private var selectedArtifact: FileArtifact?
    @State private var excavationProgress: [String: Double] = [:]
    @State private var hoveredArtifact: FileArtifact?
    @State private var viewDepth: CGFloat = 0
    
    init() {
        var layers: [TimeLayer] = []
        let currentYear = 2024
        
        for i in 0..<6 {
            let year = currentYear - i
            let depth = CGFloat(i) * 200
            
            var artifacts: [FileArtifact] = []
            let artifactCount = Int.random(in: 3...6)
            
            for j in 0..<artifactCount {
                let types = ["document", "image", "video", "code", "archive"]
                let names = ["report", "photo", "backup", "presentation", "archive"]
                
                artifacts.append(FileArtifact(
                    id: UUID(),
                    fileName: "\(names.randomElement()!)_\(year)",
                    fileType: types.randomElement()!,
                    deletionDate: Date().addingTimeInterval(-Double(i * 365 * 24 * 3600)),
                    integrity: max(0.3, 1.0 - Double(i) * 0.15),
                    position: CGPoint(
                        x: Double(j) / Double(artifactCount - 1),
                        y: Double.random(in: 0.2...0.8)
                    )
                ))
            }
            
            layers.append(TimeLayer(
                id: UUID(),
                year: year,
                depth: depth,
                artifacts: artifacts
            ))
        }
        
        _timeLayers = State(initialValue: layers)
    }
    
    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: 0) {
                ZStack {
                    Rectangle()
                        .fill(Color(white: 0.05))
                    
                    ScrollViewReader { proxy in
                        ScrollView(.vertical, showsIndicators: false) {
                            ZStack(alignment: .top) {
                                ForEach(timeLayers) { layer in
                                    TimeLayerView(
                                        layer: layer,
                                        width: geometry.size.width * 0.7,
                                        excavationProgress: excavationProgress,
                                        hoveredArtifact: hoveredArtifact,
                                        onArtifactHover: { artifact in
                                            hoveredArtifact = artifact
                                        },
                                        onArtifactTap: { artifact in
                                            withAnimation(.spring()) {
                                                selectedArtifact = artifact
                                            }
                                        }
                                    )
                                    .offset(y: layer.depth)
                                    .opacity(1.0 - (abs(viewDepth - layer.depth) / 1000))
                                    .blur(radius: max(0, (abs(viewDepth - layer.depth) / 200) - 1))
                                    .id(layer.id)
                                }
                            }
                            .frame(height: CGFloat(timeLayers.count) * 200 + 200)
                            .background(GeometryReader { geo in
                                Color.clear.preference(key: ViewOffsetKey.self, value: geo.frame(in: .named("scroll")).minY)
                            })
                        }
                        .coordinateSpace(name: "scroll")
                        .onPreferenceChange(ViewOffsetKey.self) { value in
                            viewDepth = -value
                        }
                        .gesture(
                            MagnificationGesture()
                                .onChanged { value in
                                    let layerIndex = Int(viewDepth / 200)
                                    if layerIndex >= 0 && layerIndex < timeLayers.count {
                                        let artifacts = timeLayers[layerIndex].artifacts
                                        for artifact in artifacts {
                                            let key = artifact.id.uuidString
                                            excavationProgress[key] = min(1.0, (excavationProgress[key] ?? 0) + (value - 1) * 0.2)
                                        }
                                    }
                                }
                        )
                    }
                }
                .frame(width: geometry.size.width * 0.7)
                
                if let artifact = selectedArtifact {
                    ArtifactDetailPanel(
                        artifact: artifact,
                        width: geometry.size.width * 0.3,
                        excavationProgress: excavationProgress[artifact.id.uuidString] ?? 0,
                        onClose: {
                            withAnimation(.spring()) {
                                selectedArtifact = nil
                            }
                        }
                    )
                    .transition(.move(edge: .trailing))
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}

struct TimeLayer: Identifiable {
    let id: UUID
    let year: Int
    let depth: CGFloat
    let artifacts: [FileArtifact]
}

struct FileArtifact: Identifiable {
    let id: UUID
    let fileName: String
    let fileType: String
    let deletionDate: Date
    let integrity: Double
    let position: CGPoint
}

struct TimeLayerView: View {
    let layer: TimeLayer
    let width: CGFloat
    let excavationProgress: [String: Double]
    let hoveredArtifact: FileArtifact?
    let onArtifactHover: (FileArtifact?) -> Void
    let onArtifactTap: (FileArtifact) -> Void
    
    var body: some View {
        ZStack {
            Rectangle()
                .fill(LinearGradient(
                    colors: [
                        Color(red: 0.2 - Double(layer.depth / 1000) * 0.1, 
                               green: 0.18 - Double(layer.depth / 1000) * 0.08, 
                               blue: 0.15 - Double(layer.depth / 1000) * 0.05),
                        Color(red: 0.15 - Double(layer.depth / 1000) * 0.08, 
                               green: 0.13 - Double(layer.depth / 1000) * 0.06, 
                               blue: 0.1 - Double(layer.depth / 1000) * 0.04)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                ))
                .frame(height: 200)
                .overlay(
                    Rectangle()
                        .fill(
                            LinearGradient(
                                colors: [Color.white.opacity(0.05), Color.clear],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .frame(height: 2)
                        .frame(maxHeight: .infinity, alignment: .top)
                )
            
            VStack(alignment: .leading) {
                Text(String(layer.year))
                    .font(.system(.title3, design: .default))
                    .fontWeight(.semibold)
                    .foregroundColor(.white.opacity(0.7))
                    .padding(.leading, 20)
                    .padding(.top, 10)
                
                Spacer()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            
            ForEach(layer.artifacts) { artifact in
                ArtifactView(
                    artifact: artifact,
                    width: width,
                    excavationProgress: excavationProgress[artifact.id.uuidString] ?? 0,
                    isHovered: hoveredArtifact?.id == artifact.id,
                    onHover: onArtifactHover,
                    onTap: onArtifactTap
                )
            }
        }
        .frame(width: width, height: 200)
    }
}

struct ArtifactView: View {
    let artifact: FileArtifact
    let width: CGFloat
    let excavationProgress: Double
    let isHovered: Bool
    let onHover: (FileArtifact?) -> Void
    let onTap: (FileArtifact) -> Void
    
    var artifactColor: Color {
        switch artifact.fileType {
        case "document": return Color.blue
        case "image": return Color.green
        case "video": return Color.purple
        case "code": return Color.orange
        case "archive": return Color.red
        default: return Color.gray
        }
    }
    
    var body: some View {
        let opacity = 0.3 + excavationProgress * 0.7
        let scale = 0.8 + excavationProgress * 0.2
        
        Circle()
            .fill(artifactColor.opacity(opacity * artifact.integrity))
            .frame(width: 60 * scale, height: 60 * scale)
            .overlay(
                Circle()
                    .stroke(artifactColor.opacity(opacity), lineWidth: isHovered ? 3 : 1)
                    .scaleEffect(isHovered ? 1.1 : 1.0)
            )
            .overlay(
                Image(systemName: iconForType(artifact.fileType))
                    .foregroundColor(.white.opacity(opacity))
                    .font(.system(size: 20 * scale))
            )
            .position(
                x: artifact.position.x * width,
                y: artifact.position.y * 180 + 10
            )
            .onHover { hovering in
                onHover(hovering ? artifact : nil)
            }
            .onTapGesture {
                onTap(artifact)
            }
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovered)
            .animation(.easeInOut(duration: 0.5), value: excavationProgress)
    }
    
    func iconForType(_ type: String) -> String {
        switch type {
        case "document": return "doc.text.fill"
        case "image": return "photo.fill"
        case "video": return "video.fill"
        case "code": return "curlybraces"
        case "archive": return "archivebox.fill"
        default: return "doc.fill"
        }
    }
}

struct ArtifactDetailPanel: View {
    let artifact: FileArtifact
    let width: CGFloat
    let excavationProgress: Double
    let onClose: () -> Void
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(artifact.fileName)
                    .font(.system(.title2, design: .default))
                    .fontWeight(.medium)
                    .foregroundColor(.white)
                
                Spacer()
                
                Button(action: onClose) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundColor(.white.opacity(0.5))
                }
                .buttonStyle(.plain)
            }
            .padding(20)
            
            Divider()
                .background(Color.white.opacity(0.1))
            
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    DetailRow(label: "Type", value: artifact.fileType.capitalized)
                    DetailRow(label: "Deleted", value: formatDate(artifact.deletionDate))
                    DetailRow(label: "Integrity", value: "\(Int(artifact.integrity * 100))%")
                    DetailRow(label: "Recovery", value: "\(Int(excavationProgress * 100))%")
                    
                    if excavationProgress > 0.5 {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Preview")
                                .font(.system(.headline, design: .default))
                                .foregroundColor(.white.opacity(0.7))
                            
                            RoundedRectangle(cornerRadius: 8)
                                .fill(Color.white.opacity(0.05))
                                .frame(height: 200)
                                .overlay(
                                    Text("File contents partially recovered")
                                        .foregroundColor(.white.opacity(0.3))
                                )
                        }
                    }
                    
                    if excavationProgress > 0.8 {
                        Button(action: {}) {
                            HStack {
                                Image(systemName: "arrow.down.circle.fill")
                                Text("Recover File")
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(8)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(20)
            }
        }
        .frame(width: width)
        .background(Color(white: 0.08))
        .overlay(
            Rectangle()
                .fill(Color.white.opacity(0.05))
                .frame(width: 1)
                .frame(maxWidth: .infinity, alignment: .leading)
        )
    }
    
    func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

struct DetailRow: View {
    let label: String
    let value: String
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(.caption, design: .default))
                .foregroundColor(.white.opacity(0.5))
            Text(value)
                .font(.system(.body, design: .default))
                .foregroundColor(.white.opacity(0.9))
        }
    }
}

struct ViewOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}