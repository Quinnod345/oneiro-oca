struct ContentView: View {
    @State private var selectedDate = Date()
    @State private var activities: [Activity] = [
        Activity(type: .work, startHour: 9, duration: 4, color: Color(hex: "4F46E5")),
        Activity(type: .rest, startHour: 13, duration: 1, color: Color(hex: "10B981")),
        Activity(type: .creativity, startHour: 14, duration: 3, color: Color(hex: "F59E0B")),
        Activity(type: .social, startHour: 19, duration: 2, color: Color(hex: "EC4899"))
    ]
    @State private var selectedActivity: ActivityType?
    @State private var hoveredHour: Int?
    @State private var isAddingActivity = false
    @State private var newActivityStart: Int = 12
    @State private var newActivityDuration: Int = 2
    
    let hours = Array(0..<24)
    let hourWidth: CGFloat = 44
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Timeline")
                            .font(.system(size: 28, weight: .bold, design: .rounded))
                            .foregroundColor(.primary)
                        Text("Track your daily activities")
                            .font(.system(size: 16))
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                    
                    HStack(spacing: 12) {
                        DatePicker("", selection: $selectedDate, displayedComponents: .date)
                            .labelsHidden()
                            .tint(Color(hex: "4F46E5"))
                        
                        Button(action: { isAddingActivity.toggle() }) {
                            Label("Add Activity", systemImage: "plus.circle.fill")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(.white)
                                .padding(.horizontal, 20)
                                .padding(.vertical, 10)
                                .background(Color(hex: "4F46E5"))
                                .cornerRadius(8)
                        }
                    }
                }
                .padding(.horizontal, 32)
                .padding(.vertical, 24)
                
                // Activity type selector
                HStack(spacing: 16) {
                    ForEach(ActivityType.allCases, id: \.self) { type in
                        ActivityTypeButton(
                            type: type,
                            isSelected: selectedActivity == type,
                            action: { selectedActivity = selectedActivity == type ? nil : type }
                        )
                    }
                    Spacer()
                }
                .padding(.horizontal, 32)
            }
            .background(Color(hex: "F9FAFB"))
            
            ScrollView(.horizontal, showsIndicators: false) {
                VStack(spacing: 24) {
                    // Time ruler
                    HStack(spacing: 0) {
                        ForEach(hours, id: \.self) { hour in
                            VStack(spacing: 4) {
                                Text("\(hour):00")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundColor(hoveredHour == hour ? Color(hex: "4F46E5") : .secondary)
                                Rectangle()
                                    .fill(Color.secondary.opacity(0.2))
                                    .frame(width: 1, height: 8)
                            }
                            .frame(width: hourWidth)
                            .onHover { isHovered in
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    hoveredHour = isHovered ? hour : nil
                                }
                            }
                        }
                    }
                    .padding(.leading, 32)
                    
                    // Activities timeline
                    ZStack(alignment: .leading) {
                        // Background grid
                        HStack(spacing: 0) {
                            ForEach(hours, id: \.self) { hour in
                                Rectangle()
                                    .fill(hour % 2 == 0 ? Color.clear : Color.secondary.opacity(0.03))
                                    .frame(width: hourWidth, height: 120)
                            }
                        }
                        
                        // Activity blocks
                        ForEach(filteredActivities) { activity in
                            ActivityBlock(
                                activity: activity,
                                hourWidth: hourWidth,
                                onUpdate: updateActivity
                            )
                            .offset(x: CGFloat(activity.startHour) * hourWidth)
                        }
                    }
                    .frame(height: 120)
                    .padding(.leading, 32)
                }
                .padding(.vertical, 32)
            }
            
            Spacer()
        }
        .background(Color.white)
        .sheet(isPresented: $isAddingActivity) {
            AddActivityView(
                selectedType: selectedActivity ?? .work,
                startHour: $newActivityStart,
                duration: $newActivityDuration,
                onAdd: addNewActivity,
                onCancel: { isAddingActivity = false }
            )
        }
    }
    
    var filteredActivities: [Activity] {
        if let selected = selectedActivity {
            return activities.filter { $0.type == selected }
        }
        return activities
    }
    
    func updateActivity(_ activity: Activity) {
        if let index = activities.firstIndex(where: { $0.id == activity.id }) {
            activities[index] = activity
        }
    }
    
    func addNewActivity() {
        let newActivity = Activity(
            type: selectedActivity ?? .work,
            startHour: newActivityStart,
            duration: newActivityDuration,
            color: ActivityType.color(for: selectedActivity ?? .work)
        )
        activities.append(newActivity)
        isAddingActivity = false
    }
}

struct Activity: Identifiable {
    let id = UUID()
    var type: ActivityType
    var startHour: Int
    var duration: Int
    var color: Color
}

enum ActivityType: String, CaseIterable {
    case work = "Work"
    case rest = "Rest"
    case creativity = "Creativity"
    case social = "Social"
    
    static func color(for type: ActivityType) -> Color {
        switch type {
        case .work: return Color(hex: "4F46E5")
        case .rest: return Color(hex: "10B981")
        case .creativity: return Color(hex: "F59E0B")
        case .social: return Color(hex: "EC4899")
        }
    }
    
    var icon: String {
        switch self {
        case .work: return "briefcase.fill"
        case .rest: return "leaf.fill"
        case .creativity: return "paintbrush.fill"
        case .social: return "person.2.fill"
        }
    }
}

struct ActivityTypeButton: View {
    let type: ActivityType
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: type.icon)
                    .font(.system(size: 14))
                Text(type.rawValue)
                    .font(.system(size: 14, weight: .medium))
            }
            .foregroundColor(isSelected ? .white : .secondary)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(isSelected ? ActivityType.color(for: type) : Color.secondary.opacity(0.1))
            )
        }
        .buttonStyle(PlainButtonStyle())
    }
}

struct ActivityBlock: View {
    let activity: Activity
    let hourWidth: CGFloat
    let onUpdate: (Activity) -> Void
    
    @State private var isHovered = false
    @State private var isDragging = false
    
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(activity.color.opacity(isHovered ? 1.0 : 0.9))
            .frame(width: CGFloat(activity.duration) * hourWidth - 8, height: 80)
            .overlay(
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Image(systemName: activity.type.icon)
                            .font(.system(size: 16, weight: .medium))
                        Text(activity.type.rawValue)
                            .font(.system(size: 14, weight: .semibold))
                    }
                    Text("\(activity.duration) hour\(activity.duration > 1 ? "s" : "")")
                        .font(.system(size: 12))
                        .opacity(0.8)
                }
                .foregroundColor(.white)
                .padding(12)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            )
            .shadow(color: activity.color.opacity(isHovered ? 0.4 : 0.2), radius: isHovered ? 8 : 4, y: 2)
            .scaleEffect(isDragging ? 1.05 : 1.0)
            .animation(.spring(response: 0.3), value: isDragging)
            .animation(.spring(response: 0.3), value: isHovered)
            .onHover { hovering in
                isHovered = hovering
            }
            .draggable(activity) {
                self
                    .onAppear { isDragging = true }
                    .onDisappear { isDragging = false }
            }
    }
}

struct AddActivityView: View {
    let selectedType: ActivityType
    @Binding var startHour: Int
    @Binding var duration: Int
    let onAdd: () -> Void
    let onCancel: () -> Void
    
    var body: some View {
        VStack(spacing: 24) {
            Text("Add New Activity")
                .font(.system(size: 24, weight: .bold))
            
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Start Time")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.secondary)
                    Picker("Start Hour", selection: $startHour) {
                        ForEach(0..<24) { hour in
                            Text("\(hour):00").tag(hour)
                        }
                    }
                    .pickerStyle(WheelPickerStyle())
                    .frame(height: 100)
                }
                
                VStack(alignment: .leading, spacing: 8) {
                    Text("Duration")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.secondary)
                    Picker("Duration", selection: $duration) {
                        ForEach(1..<9) { hours in
                            Text("\(hours) hour\(hours > 1 ? "s" : "")").tag(hours)
                        }
                    }
                    .pickerStyle(SegmentedPickerStyle())
                }
            }
            .padding(.horizontal)
            
            HStack(spacing: 16) {
                Button("Cancel", action: onCancel)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 32)
                    .padding(.vertical, 12)
                    .background(Color.secondary.opacity(0.1))
                    .cornerRadius(8)
                
                Button("Add Activity", action: onAdd)
                    .foregroundColor(.white)
                    .padding(.horizontal, 32)
                    .padding(.vertical, 12)
                    .background(ActivityType.color(for: selectedType))
                    .cornerRadius(8)
            }
        }
        .padding(32)
        .frame(width: 400)
    }
}

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (1, 1, 1, 0)
        }
        self.init(.sRGB, red: Double(r) / 255, green: Double(g) / 255, blue:  Double(b) / 255, opacity: Double(a) / 255)
    }
}