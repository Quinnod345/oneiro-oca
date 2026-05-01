struct ContentView: View {
    @State private var selectedFloor: Int = 0
    @State private var rooms: [Room] = [
        Room(name: "Living Room", temperature: 22, occupancy: 3, energy: 45),
        Room(name: "Kitchen", temperature: 24, occupancy: 1, energy: 78),
        Room(name: "Bedroom 1", temperature: 20, occupancy: 0, energy: 12),
        Room(name: "Bedroom 2", temperature: 21, occupancy: 2, energy: 23),
        Room(name: "Office", temperature: 23, occupancy: 1, energy: 67)
    ]
    @State private var totalEnergyUsage: Double = 0
    @State private var targetTemperature: Double = 22
    
    let floors = ["Ground Floor", "First Floor", "Second Floor"]
    
    var body: some View {
        HStack(spacing: 0) {
            // Sidebar
            VStack(spacing: 0) {
                // Header
                VStack(alignment: .leading, spacing: 8) {
                    Text("Building Monitor")
                        .font(.title2)
                        .fontWeight(.semibold)
                        .foregroundColor(.white)
                    
                    Text("Real-time overview")
                        .font(.subheadline)
                        .foregroundColor(.white.opacity(0.7))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
                
                // Floor Selection
                VStack(alignment: .leading, spacing: 12) {
                    Text("FLOORS")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.white.opacity(0.5))
                    
                    VStack(spacing: 4) {
                        ForEach(0..<floors.count, id: \.self) { index in
                            FloorButton(
                                title: floors[index],
                                isSelected: selectedFloor == index,
                                action: { selectedFloor = index }
                            )
                        }
                    }
                }
                .padding(.horizontal, 24)
                
                Spacer()
                
                // Energy Overview
                VStack(alignment: .leading, spacing: 16) {
                    Text("ENERGY USAGE")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.white.opacity(0.5))
                    
                    VStack(alignment: .leading, spacing: 8) {
                        Text("\(Int(totalEnergyUsage))%")
                            .font(.largeTitle)
                            .fontWeight(.semibold)
                            .foregroundColor(.white)
                        
                        ProgressView(value: totalEnergyUsage / 100)
                            .progressViewStyle(LinearProgressViewStyle())
                            .tint(.green)
                            .scaleEffect(x: 1, y: 2)
                        
                        Text("Average consumption")
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.7))
                    }
                }
                .padding(24)
                .background(Color.white.opacity(0.05))
                .cornerRadius(12)
                .padding(24)
            }
            .frame(width: 280)
            .background(Color(red: 0.11, green: 0.11, blue: 0.12))
            
            // Main Content
            VStack(spacing: 0) {
                // Header
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(floors[selectedFloor])
                            .font(.title)
                            .fontWeight(.semibold)
                            .foregroundColor(.primary)
                        
                        Text("\(rooms.count) rooms monitored")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                    
                    // Temperature Control
                    HStack(spacing: 16) {
                        Text("Target Temperature")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        
                        HStack(spacing: 12) {
                            Button(action: { targetTemperature -= 0.5 }) {
                                Image(systemName: "minus.circle")
                                    .font(.title3)
                                    .foregroundColor(.accentColor)
                            }
                            
                            Text("\(targetTemperature, specifier: "%.1f")°C")
                                .font(.title3)
                                .fontWeight(.medium)
                                .frame(width: 60)
                            
                            Button(action: { targetTemperature += 0.5 }) {
                                Image(systemName: "plus.circle")
                                    .font(.title3)
                                    .foregroundColor(.accentColor)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Color(UIColor.systemGray6))
                        .cornerRadius(8)
                    }
                }
                .padding(32)
                
                // Room Grid
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 20)], spacing: 20) {
                        ForEach(rooms) { room in
                            RoomCard(room: room, targetTemperature: targetTemperature)
                        }
                    }
                    .padding(32)
                }
            }
            .background(Color(UIColor.systemBackground))
            .onAppear {
                updateTotalEnergy()
            }
        }
    }
    
    func updateTotalEnergy() {
        totalEnergyUsage = rooms.map(\.energy).reduce(0, +) / Double(rooms.count)
    }
}

struct FloorButton: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            HStack {
                Text(title)
                    .font(.subheadline)
                    .fontWeight(isSelected ? .medium : .regular)
                    .foregroundColor(isSelected ? .white : .white.opacity(0.7))
                
                Spacer()
                
                if isSelected {
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.5))
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(isSelected ? Color.white.opacity(0.1) : Color.clear)
            .cornerRadius(8)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

struct RoomCard: View {
    let room: Room
    let targetTemperature: Double
    
    var temperatureStatus: (color: Color, icon: String) {
        let diff = room.temperature - targetTemperature
        if abs(diff) <= 1 {
            return (.green, "checkmark.circle.fill")
        } else if diff > 1 {
            return (.orange, "thermometer.sun.fill")
        } else {
            return (.blue, "thermometer.snowflake")
        }
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            // Header
            HStack {
                Text(room.name)
                    .font(.headline)
                    .foregroundColor(.primary)
                
                Spacer()
                
                Image(systemName: temperatureStatus.icon)
                    .foregroundColor(temperatureStatus.color)
            }
            
            // Stats Grid
            VStack(spacing: 16) {
                HStack(spacing: 16) {
                    StatItem(
                        icon: "thermometer",
                        value: "\(room.temperature)°C",
                        label: "Temperature"
                    )
                    
                    StatItem(
                        icon: "person.2",
                        value: "\(room.occupancy)",
                        label: "Occupancy"
                    )
                }
                
                // Energy Bar
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Image(systemName: "bolt.fill")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        
                        Text("Energy Usage")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        
                        Spacer()
                        
                        Text("\(Int(room.energy))%")
                            .font(.caption)
                            .fontWeight(.medium)
                            .foregroundColor(.primary)
                    }
                    
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            Rectangle()
                                .fill(Color(UIColor.systemGray5))
                                .frame(height: 4)
                            
                            Rectangle()
                                .fill(energyColor(for: room.energy))
                                .frame(width: geometry.size.width * (room.energy / 100), height: 4)
                        }
                        .cornerRadius(2)
                    }
                    .frame(height: 4)
                }
            }
        }
        .padding(20)
        .background(Color(UIColor.secondarySystemBackground))
        .cornerRadius(12)
    }
    
    func energyColor(for value: Double) -> Color {
        switch value {
        case 0..<30: return .green
        case 30..<70: return .yellow
        default: return .red
        }
    }
}

struct StatItem: View {
    let icon: String
    let value: String
    let label: String
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                Text(value)
                    .font(.title3)
                    .fontWeight(.medium)
                    .foregroundColor(.primary)
            }
            
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct Room: Identifiable {
    let id = UUID()
    let name: String
    let temperature: Double
    let occupancy: Int
    let energy: Double
}