struct ContentView: View {
    @State private var tasks: [Task] = [
        Task(id: UUID(), title: "Design Review", duration: 2, negotiatedDuration: 2, color: Color.blue),
        Task(id: UUID(), title: "Team Meeting", duration: 1.5, negotiatedDuration: 1.5, color: Color.green),
        Task(id: UUID(), title: "Deep Work", duration: 4, negotiatedDuration: 4, color: Color.purple)
    ]
    @State private var selectedTask: UUID?
    @State private var timeBalance: Double = 8
    @State private var negotiationAmount: Double = 0
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(spacing: 8) {
                Text("Time Negotiation")
                    .font(.system(size: 28, weight: .medium, design: .default))
                    .foregroundColor(.primary)
                
                Text("\(Int(timeBalance)) hours available today")
                    .font(.system(size: 16, weight: .regular))
                    .foregroundColor(.secondary)
            }
            .padding(.vertical, 24)
            
            // Main content
            ScrollView {
                VStack(spacing: 16) {
                    ForEach($tasks) { $task in
                        TaskCard(
                            task: $task,
                            isSelected: selectedTask == task.id,
                            onSelect: {
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    selectedTask = task.id
                                    negotiationAmount = task.negotiatedDuration
                                }
                            }
                        )
                    }
                }
                .padding(.horizontal, 20)
            }
            
            // Negotiation panel
            if let selected = selectedTask,
               let taskIndex = tasks.firstIndex(where: { $0.id == selected }) {
                VStack(spacing: 20) {
                    Divider()
                    
                    VStack(spacing: 12) {
                        Text("Negotiate Duration")
                            .font(.system(size: 18, weight: .medium))
                        
                        HStack(spacing: 24) {
                            Text("\(negotiationAmount, specifier: "%.1f")h")
                                .font(.system(size: 32, weight: .light, design: .rounded))
                                .foregroundColor(tasks[taskIndex].color)
                            
                            VStack(spacing: 8) {
                                Button(action: {
                                    if negotiationAmount < tasks[taskIndex].duration {
                                        negotiationAmount += 0.5
                                    }
                                }) {
                                    Image(systemName: "chevron.up")
                                        .foregroundColor(negotiationAmount >= tasks[taskIndex].duration ? .secondary : .primary)
                                }
                                .disabled(negotiationAmount >= tasks[taskIndex].duration)
                                
                                Button(action: {
                                    if negotiationAmount > 0.5 {
                                        negotiationAmount -= 0.5
                                    }
                                }) {
                                    Image(systemName: "chevron.down")
                                        .foregroundColor(negotiationAmount <= 0.5 ? .secondary : .primary)
                                }
                                .disabled(negotiationAmount <= 0.5)
                            }
                        }
                        
                        if negotiationAmount < tasks[taskIndex].duration {
                            Text("Save \(tasks[taskIndex].duration - negotiationAmount, specifier: "%.1f") hours")
                                .font(.system(size: 14))
                                .foregroundColor(.green)
                        }
                    }
                    
                    HStack(spacing: 12) {
                        Button(action: {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                selectedTask = nil
                            }
                        }) {
                            Text("Cancel")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(Color(.systemGray5))
                                .foregroundColor(.primary)
                                .cornerRadius(10)
                        }
                        
                        Button(action: {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                let difference = tasks[taskIndex].negotiatedDuration - negotiationAmount
                                tasks[taskIndex].negotiatedDuration = negotiationAmount
                                timeBalance += difference
                                selectedTask = nil
                            }
                        }) {
                            Text("Confirm")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(tasks[taskIndex].color)
                                .foregroundColor(.white)
                                .cornerRadius(10)
                        }
                    }
                }
                .padding(20)
                .background(Color(.systemBackground))
            }
        }
        .frame(maxWidth: 600)
        .background(Color(.systemGroupedBackground))
    }
}

struct Task: Identifiable {
    let id: UUID
    let title: String
    let duration: Double
    var negotiatedDuration: Double
    let color: Color
}

struct TaskCard: View {
    @Binding var task: Task
    let isSelected: Bool
    let onSelect: () -> Void
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Circle()
                    .fill(task.color)
                    .frame(width: 12, height: 12)
                
                Text(task.title)
                    .font(.system(size: 18, weight: .medium))
                
                Spacer()
                
                if task.negotiatedDuration < task.duration {
                    Text("-\(task.duration - task.negotiatedDuration, specifier: "%.1f")h")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.green)
                }
            }
            
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Original")
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                    Text("\(task.duration, specifier: "%.1f") hours")
                        .font(.system(size: 16))
                }
                
                Spacer()
                
                Image(systemName: "arrow.right")
                    .foregroundColor(.secondary)
                
                Spacer()
                
                VStack(alignment: .trailing, spacing: 4) {
                    Text("Current")
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                    Text("\(task.negotiatedDuration, specifier: "%.1f") hours")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(task.color)
                }
            }
        }
        .padding(20)
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(isSelected ? task.color : Color.clear, lineWidth: 2)
        )
        .shadow(color: Color.black.opacity(0.05), radius: 8, x: 0, y: 2)
        .onTapGesture(perform: onSelect)
    }
}