struct ContentView: View {
    @State private var sleeplessHours: Int = 0
    @State private var currentDistortion: CGFloat = 0
    @State private var inputText: String = ""
    
    var maxDistortion: CGFloat {
        min(CGFloat(sleeplessHours) / 72.0, 1.0)
    }
    
    var body: some View {
        ZStack {
            // Subtle gradient background
            LinearGradient(
                colors: [
                    Color(red: 0.98, green: 0.97, blue: 0.96),
                    Color(red: 0.94, green: 0.93, blue: 0.92)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            
            // Single subtle distortion overlay
            GeometryReader { geometry in
                ForEach(0..<3) { i in
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    Color.white.opacity(0.03),
                                    Color.clear
                                ],
                                center: .center,
                                startRadius: 0,
                                endRadius: 200
                            )
                        )
                        .frame(width: 400, height: 400)
                        .position(
                            x: geometry.size.width * (0.2 + CGFloat(i) * 0.3),
                            y: geometry.size.height * 0.5
                        )
                        .scaleEffect(1 + currentDistortion * 0.2)
                        .animation(.easeInOut(duration: 3), value: currentDistortion)
                }
            }
            .ignoresSafeArea()
            
            VStack(spacing: 60) {
                // Clean, readable title
                Text("Sleep Tracker")
                    .font(.system(size: 32, weight: .light, design: .rounded))
                    .foregroundColor(Color(red: 0.2, green: 0.2, blue: 0.2))
                    .padding(.top, 80)
                
                // Visual sleep indicator
                ZStack {
                    Circle()
                        .stroke(Color(red: 0.9, green: 0.9, blue: 0.9), lineWidth: 2)
                        .frame(width: 180, height: 180)
                    
                    Circle()
                        .trim(from: 0, to: 1 - currentDistortion)
                        .stroke(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.4, green: 0.6, blue: 0.8),
                                    Color(red: 0.6, green: 0.4, blue: 0.6)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            style: StrokeStyle(lineWidth: 8, lineCap: .round)
                        )
                        .frame(width: 180, height: 180)
                        .rotationEffect(.degrees(-90))
                        .animation(.easeInOut(duration: 1), value: currentDistortion)
                    
                    VStack(spacing: 4) {
                        Text("\(sleeplessHours)")
                            .font(.system(size: 48, weight: .light, design: .rounded))
                            .foregroundColor(Color(red: 0.2, green: 0.2, blue: 0.2))
                        
                        Text("hours awake")
                            .font(.system(size: 14, weight: .regular, design: .rounded))
                            .foregroundColor(Color(red: 0.5, green: 0.5, blue: 0.5))
                    }
                }
                .offset(y: sin(currentDistortion * .pi) * 5)
                .animation(.easeInOut(duration: 2), value: currentDistortion)
                
                // Clean input section
                VStack(spacing: 16) {
                    Text("Hours without sleep")
                        .font(.system(size: 16, weight: .regular, design: .rounded))
                        .foregroundColor(Color(red: 0.4, green: 0.4, blue: 0.4))
                    
                    HStack(spacing: 0) {
                        TextField("0", text: Binding(
                            get: { sleeplessHours == 0 ? "" : String(sleeplessHours) },
                            set: { newValue in
                                if let hours = Int(newValue) {
                                    sleeplessHours = max(0, min(168, hours))
                                    withAnimation(.easeInOut(duration: 1)) {
                                        currentDistortion = maxDistortion
                                    }
                                } else if newValue.isEmpty {
                                    sleeplessHours = 0
                                    withAnimation(.easeInOut(duration: 1)) {
                                        currentDistortion = 0
                                    }
                                }
                            }
                        ))
                        .font(.system(size: 24, weight: .light, design: .rounded))
                        .foregroundColor(Color(red: 0.2, green: 0.2, blue: 0.2))
                        .multilineTextAlignment(.center)
                        .textFieldStyle(PlainTextFieldStyle())
                        .frame(width: 100)
                        .padding(.vertical, 12)
                        .padding(.horizontal, 20)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(Color.white)
                                .shadow(color: Color.black.opacity(0.05), radius: 8, x: 0, y: 2)
                        )
                    }
                }
                
                // Status indicator
                VStack(spacing: 8) {
                    Text(statusText)
                        .font(.system(size: 18, weight: .medium, design: .rounded))
                        .foregroundColor(statusColor)
                        .animation(.easeInOut, value: sleeplessHours)
                    
                    Text(statusDescription)
                        .font(.system(size: 14, weight: .regular, design: .rounded))
                        .foregroundColor(Color(red: 0.5, green: 0.5, blue: 0.5))
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 300)
                        .animation(.easeInOut, value: sleeplessHours)
                }
                .opacity(sleeplessHours > 0 ? 1 : 0)
                .animation(.easeInOut(duration: 0.5), value: sleeplessHours > 0)
                
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
    
    var statusText: String {
        switch sleeplessHours {
        case 0..<24:
            return "Well Rested"
        case 24..<48:
            return "Sleep Deprived"
        case 48..<72:
            return "Severely Exhausted"
        default:
            return "Critical Condition"
        }
    }
    
    var statusDescription: String {
        switch sleeplessHours {
        case 0..<24:
            return "Your sleep schedule is healthy"
        case 24..<48:
            return "Consider getting rest soon"
        case 48..<72:
            return "Seek immediate rest"
        default:
            return "Medical attention recommended"
        }
    }
    
    var statusColor: Color {
        switch sleeplessHours {
        case 0..<24:
            return Color(red: 0.4, green: 0.6, blue: 0.8)
        case 24..<48:
            return Color(red: 0.7, green: 0.5, blue: 0.3)
        case 48..<72:
            return Color(red: 0.8, green: 0.4, blue: 0.3)
        default:
            return Color(red: 0.9, green: 0.3, blue: 0.3)
        }
    }
}