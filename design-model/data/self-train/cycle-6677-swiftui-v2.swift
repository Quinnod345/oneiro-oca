struct ContentView: View {
    @State private var memoryPlants: [MemoryPlant] = []
    @State private var selectedPlant: UUID?
    @State private var currentDepth: Double = 0.5
    @State private var showingAddMemory = false
    @State private var newMemoryText = ""
    
    let depthLevels = ["Surface", "Shallow", "Deep"]
    
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.95, green: 0.96, blue: 0.98),
                    Color(red: 0.92, green: 0.94, blue: 0.96)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            
            VStack(spacing: 0) {
                headerView
                
                GeometryReader { geometry in
                    ZStack {
                        depthIndicators(in: geometry)
                        
                        ForEach(Array(memoryPlants.suffix(5))) { plant in
                            PlantCard(
                                plant: plant,
                                isSelected: selectedPlant == plant.id,
                                depth: plant.depth
                            )
                            .position(
                                x: geometry.size.width * plant.position.x,
                                y: geometry.size.height * plant.depth
                            )
                            .onTapGesture {
                                withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                                    selectedPlant = selectedPlant == plant.id ? nil : plant.id
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal)
                
                controlsView
            }
            
            if showingAddMemory {
                addMemoryOverlay
            }
        }
    }
    
    var headerView: some View {
        VStack(spacing: 4) {
            Text("Memory Garden")
                .font(.system(.title, design: .rounded))
                .fontWeight(.semibold)
                .foregroundColor(.primary)
            
            Text("\(memoryPlants.count) memories planted")
                .font(.system(.subheadline, design: .rounded))
                .foregroundColor(.secondary)
        }
        .padding(.top, 20)
        .padding(.bottom, 12)
    }
    
    func depthIndicators(in geometry: GeometryProxy) -> some View {
        VStack(spacing: 0) {
            ForEach(0..<3) { index in
                Rectangle()
                    .fill(Color.gray.opacity(0.1))
                    .frame(height: 1)
                    .overlay(
                        HStack {
                            Text(depthLevels[index])
                                .font(.system(.caption2, design: .rounded))
                                .foregroundColor(.secondary)
                                .padding(.horizontal, 8)
                                .background(Color(red: 0.95, green: 0.96, blue: 0.98))
                            Spacer()
                        }
                    )
                
                if index < 2 {
                    Spacer()
                }
            }
        }
    }
    
    var controlsView: some View {
        VStack(spacing: 16) {
            Picker("Depth", selection: $currentDepth) {
                Text("Surface").tag(0.2)
                Text("Shallow").tag(0.5)
                Text("Deep").tag(0.8)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            
            Button(action: { showingAddMemory = true }) {
                Label("Plant Memory", systemImage: "plus.circle.fill")
                    .font(.system(.body, design: .rounded))
                    .fontWeight(.medium)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.green)
                    .cornerRadius(12)
            }
            .padding(.horizontal)
        }
        .padding(.vertical, 20)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color.white)
                .shadow(color: .black.opacity(0.05), radius: 10, y: -5)
        )
    }
    
    var addMemoryOverlay: some View {
        ZStack {
            Color.black.opacity(0.3)
                .ignoresSafeArea()
                .onTapGesture { showingAddMemory = false }
            
            VStack(spacing: 20) {
                Text("New Memory")
                    .font(.system(.title3, design: .rounded))
                    .fontWeight(.semibold)
                
                TextField("Describe your memory...", text: $newMemoryText)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                    .font(.system(.body, design: .rounded))
                
                HStack(spacing: 12) {
                    Button("Cancel") {
                        showingAddMemory = false
                        newMemoryText = ""
                    }
                    .foregroundColor(.secondary)
                    
                    Button("Plant") {
                        plantMemory()
                        showingAddMemory = false
                    }
                    .fontWeight(.medium)
                    .foregroundColor(.white)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 8)
                    .background(Color.green)
                    .cornerRadius(8)
                    .disabled(newMemoryText.isEmpty)
                }
            }
            .padding(24)
            .background(Color.white)
            .cornerRadius(16)
            .shadow(radius: 20)
            .padding(40)
        }
    }
    
    func plantMemory() {
        let newPlant = MemoryPlant(
            content: newMemoryText,
            depth: currentDepth,
            position: CGPoint(x: Double.random(in: 0.2...0.8), y: currentDepth)
        )
        memoryPlants.append(newPlant)
        newMemoryText = ""
    }
}

struct PlantCard: View {
    let plant: MemoryPlant
    let isSelected: Bool
    let depth: Double
    
    var growthColor: Color {
        switch plant.growthStage {
        case 0..<0.3: return .orange
        case 0.3..<0.7: return .yellow
        default: return .green
        }
    }
    
    var body: some View {
        VStack(spacing: 4) {
            Circle()
                .fill(growthColor)
                .frame(width: isSelected ? 48 : 40, height: isSelected ? 48 : 40)
                .overlay(
                    Image(systemName: "leaf.fill")
                        .foregroundColor(.white)
                        .font(.system(size: isSelected ? 20 : 16))
                )
            
            if isSelected {
                Text(plant.content)
                    .font(.system(.caption, design: .rounded))
                    .foregroundColor(.primary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .frame(width: 100)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.white)
                    .cornerRadius(8)
                    .shadow(radius: 4)
            }
        }
        .scaleEffect(isSelected ? 1.1 : 1.0)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isSelected)
    }
}

struct MemoryPlant: Identifiable {
    let id = UUID()
    let content: String
    let depth: Double
    let position: CGPoint
    let plantedDate = Date()
    var growthStage: Double = 0.5
}