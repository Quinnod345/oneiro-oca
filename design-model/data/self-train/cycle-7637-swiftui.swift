struct ContentView: View {
    @State private var timeLayers: [TimeLayer] = []
    @State private var currentDepth: CGFloat = 0
    @State private var brushPosition: CGPoint = .zero
    @State private var isBrushing: Bool = false
    @State private var excavatedRegions: Set<String> = []
    @State private var selectedArtifact: FileArtifact?
    @State private var dragVelocity: CGFloat = 0
    
    let layerHeight: CGFloat = 120
    
    init() {
        var layers: [TimeLayer] = []
        let currentYear = 2024
        
        for i in 0..<8 {
            let year = currentYear - i
            let depth = CGFloat(i) * layerHeight
            let fragmentation = CGFloat(i) * 0.15
            
            var artifacts: [FileArtifact] = []
            let artifactCount = Int.random(in: 3...7)
            
            for _ in 0..<artifactCount {
                let types = ["document", "image", "video", "code", "archive"]
                let names = ["report_final", "vacation_photo", "project_backup", "presentation", "old_resume", "family_video", "source_code", "design_mockup"]
                
                artifacts.append(FileArtifact(
                    fileName: "\(names.randomElement()!)_\(year)",
                    fileType: types.randomElement()!,
                    deletionDate: Date().addingTimeInterval(-Double(i * 365 * 24 * 3600) - Double.random(in: 0...(365 * 24 * 3600))),
                    integrity: max(0.2, 1.0 - fragmentation - CGFloat.random(in: 0...0.3)),
                    position: CGPoint(
                        x: CGFloat.random(in: 100...900),
                        y: depth + CGFloat.random(in: 20...100)
                    )
                ))
            }
            
            layers.append(TimeLayer(
                year: year,
                depth: depth,
                opacity: 1.0 - CGFloat(i) * 0.1,
                fragmentationLevel: fragmentation,
                artifacts: artifacts
            ))
        }
        
        _timeLayers = State(initialValue: layers)
    }
    
    var body: some View {
        HStack(spacing: 0) {
            // Main excavation view
            ZStack {
                // Background gradient
                LinearGradient(
                    colors: [
                        Color(red: 0.15, green: 0.12, blue: 0.10),
                        Color(red: 0.08, green: 0.06, blue: 0.05)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                
                // Time layers
                ScrollView(showsIndicators: false) {
                    ZStack(alignment: .top) {
                        ForEach(Array(timeLayers.enumerated()), id: \.element.id) { index, layer in
                            TimeLayerView(
                                layer: layer,
                                index: index,
                                excavatedRegions: excavatedRegions,
                                onArtifactTap: { artifact in
                                    selectedArtifact = artifact
                                }
                            )
                            .offset(y: layer.depth)
                        }
                        
                        // Brush cursor
                        ExcavationBrush(position: brushPosition, isActive: isBrushing)
                    }
                    .frame(height: CGFloat(timeLayers.count) * layerHeight + 200)
                }
                .onContinuousHover { phase in
                    switch phase {
                    case .active(let location):
                        brushPosition = location
                    case .ended:
                        isBrushing = false
                    }
                }
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            isBrushing = true
                            brushPosition = value.location
                            
                            // Calculate brush velocity for circular motion detection
                            let distance = sqrt(pow(value.translation.width, 2) + pow(value.translation.height, 2))
                            dragVelocity = distance / 100
                            
                            // Add excavated region
                            let regionKey = "\(Int(value.location.x / 50))-\(Int(value.location.y / 50))"
                            excavatedRegions.insert(regionKey)
                            
                            // Update current depth
                            currentDepth = value.location.y
                        }
                        .onEnded { _ in
                            isBrushing = false
                            dragVelocity = 0
                        }
                )
            }
            .frame(width: 1000)
            
            // Side panel
            VStack(alignment: .leading, spacing: 0) {
                // Header
                VStack(alignment: .leading, spacing: 12) {
                    Text("TEMPORAL EXCAVATION")
                        .font(.system(size: 14, weight: .bold, design: .monospaced))
                        .foregroundColor(Color(red: 0.8, green: 0.7, blue: 0.6))
                    
                    Divider()
                        .background(Color(red: 0.3, green: 0.25, blue: 0.2))
                }
                .padding(24)
                
                // Depth indicator
                VStack(alignment: .leading, spacing: 16) {
                    Text("EXCAVATION DEPTH")
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundColor(Color(red: 0.6, green: 0.5, blue: 0.4))
                    
                    let yearDepth = min(7, Int(currentDepth / layerHeight))
                    let currentYear = 2024 - yearDepth
                    
                    Text("\(currentYear)")
                        .font(.system(size: 32, weight: .thin, design: .serif))
                        .foregroundColor(.white)
                    
                    Text("\(Int(currentDepth)) pixels deep")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
                }
                .padding(.horizontal, 24)
                
                Divider()
                    .background(Color(red: 0.3, green: 0.25, blue: 0.2))
                    .padding(.vertical, 24)
                
                // Selected artifact details
                if let artifact = selectedArtifact {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("ARTIFACT ANALYSIS")
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                            .foregroundColor(Color(red: 0.6, green: 0.5, blue: 0.4))
                        
                        VStack(alignment: .leading, spacing: 8) {
                            Text(artifact.fileName)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(.white)
                            
                            Text("Type: \(artifact.fileType)")
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundColor(Color(red: 0.7, green: 0.6, blue: 0.5))
                            
                            Text("Integrity: \(Int(artifact.integrity * 100))%")
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundColor(artifact.integrity > 0.7 ? .green : artifact.integrity > 0.4 ? .orange : .red)
                            
                            Text("Deleted: \(formattedDate(artifact.deletionDate))")
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
                        }
                    }
                    .padding(.horizontal, 24)
                    .transition(.opacity)
                }
                
                Spacer()
                
                // Instructions
                VStack(alignment: .leading, spacing: 8) {
                    Text("INSTRUCTIONS")
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundColor(Color(red: 0.6, green: 0.5, blue: 0.4))
                    
                    Text("• Drag to excavate layers")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
                    
                    Text("• Click artifacts to analyze")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
                    
                    Text("• Deeper layers = older data")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(Color(red: 0.5, green: 0.4, blue: 0.3))
                }
                .padding(24)
            }
            .frame(width: 300)
            .background(Color(red: 0.1, green: 0.08, blue: 0.06))
        }
        .frame(width: 1300, height: 800)
        .background(Color.black)
    }
    
    func formattedDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}