struct ContentView: View {
    @State private var currentExpression: String = ""
    @State private var result: String = ""
    @State private var dreamIntensity: Double = 0.0
    @State private var selectedOperation: String = ""
    
    let numbers = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0"]
    let operations = ["+", "-", "×", "÷"]
    
    var body: some View {
        ZStack {
            // Subtle gradient background
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.05, blue: 0.15),
                    Color(red: 0.1, green: 0.05, blue: 0.2)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            
            // Subtle floating orbs
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(Color.white.opacity(0.03))
                    .frame(width: 200)
                    .blur(radius: 40)
                    .offset(
                        x: sin(Date().timeIntervalSince1970 * 0.2 + Double(index)) * 100,
                        y: cos(Date().timeIntervalSince1970 * 0.15 + Double(index)) * 80
                    )
                    .animation(.easeInOut(duration: 8).repeatForever(autoreverses: true), value: Date().timeIntervalSince1970)
            }
            
            VStack(spacing: 30) {
                // Display
                VStack(spacing: 10) {
                    Text(currentExpression.isEmpty ? "0" : currentExpression)
                        .font(.system(size: 48, weight: .thin, design: .rounded))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .padding(.horizontal, 30)
                    
                    if !result.isEmpty {
                        Text(result)
                            .font(.system(size: 36, weight: .ultraLight, design: .rounded))
                            .foregroundColor(Color.white.opacity(0.6))
                            .frame(maxWidth: .infinity, alignment: .trailing)
                            .padding(.horizontal, 30)
                            .transition(.opacity.combined(with: .scale(scale: 0.8)))
                    }
                }
                .frame(height: 120)
                .background(Color.white.opacity(0.05))
                .cornerRadius(20)
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                )
                .padding(.horizontal, 20)
                .padding(.top, 40)
                
                // Operations
                HStack(spacing: 15) {
                    ForEach(operations, id: \.self) { operation in
                        OperationButton(
                            symbol: operation,
                            isSelected: selectedOperation == operation,
                            action: {
                                handleOperation(operation)
                            }
                        )
                    }
                }
                .padding(.horizontal, 20)
                
                // Number pad
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 15), count: 3), spacing: 15) {
                    ForEach(numbers, id: \.self) { number in
                        NumberButton(
                            number: number,
                            action: {
                                appendNumber(number)
                            }
                        )
                    }
                    
                    // Clear button
                    Button(action: clear) {
                        Text("C")
                            .font(.system(size: 24, weight: .light, design: .rounded))
                            .foregroundColor(.white)
                            .frame(width: 80, height: 80)
                            .background(Color.red.opacity(0.2))
                            .clipShape(Circle())
                            .overlay(
                                Circle()
                                    .stroke(Color.red.opacity(0.3), lineWidth: 1)
                            )
                    }
                    
                    // Equals button
                    Button(action: calculate) {
                        Text("=")
                            .font(.system(size: 32, weight: .light, design: .rounded))
                            .foregroundColor(.white)
                            .frame(width: 80, height: 80)
                            .background(Color.blue.opacity(0.3))
                            .clipShape(Circle())
                            .overlay(
                                Circle()
                                    .stroke(Color.blue.opacity(0.4), lineWidth: 1)
                            )
                    }
                }
                .padding(.horizontal, 20)
                
                Spacer()
            }
        }
        .preferredColorScheme(.dark)
    }
    
    func appendNumber(_ number: String) {
        currentExpression += number
        dreamIntensity = min(dreamIntensity + 0.1, 1.0)
    }
    
    func handleOperation(_ operation: String) {
        if !currentExpression.isEmpty {
            currentExpression += " \(operation) "
            selectedOperation = operation
        }
    }
    
    func calculate() {
        let expression = currentExpression
            .replacingOccurrences(of: "×", with: "*")
            .replacingOccurrences(of: "÷", with: "/")
        
        if let result = evaluateExpression(expression) {
            self.result = "= \(result)"
            withAnimation(.easeInOut(duration: 0.3)) {
                dreamIntensity = 1.0
            }
        }
    }
    
    func clear() {
        currentExpression = ""
        result = ""
        selectedOperation = ""
        withAnimation(.easeOut(duration: 0.3)) {
            dreamIntensity = 0.0
        }
    }
    
    func evaluateExpression(_ expression: String) -> String? {
        let mathExpression = NSExpression(format: expression)
        if let result = mathExpression.expressionValue(with: nil, context: nil) as? NSNumber {
            let formatter = NumberFormatter()
            formatter.minimumFractionDigits = 0
            formatter.maximumFractionDigits = 2
            return formatter.string(from: result)
        }
        return nil
    }
}

struct NumberButton: View {
    let number: String
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            Text(number)
                .font(.system(size: 28, weight: .light, design: .rounded))
                .foregroundColor(.white)
                .frame(width: 80, height: 80)
                .background(Color.white.opacity(0.1))
                .clipShape(Circle())
                .overlay(
                    Circle()
                        .stroke(Color.white.opacity(0.2), lineWidth: 1)
                )
        }
        .buttonStyle(DreamButtonStyle())
    }
}

struct OperationButton: View {
    let symbol: String
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            Text(symbol)
                .font(.system(size: 28, weight: .light, design: .rounded))
                .foregroundColor(.white)
                .frame(width: 70, height: 70)
                .background(
                    Circle()
                        .fill(isSelected ? Color.blue.opacity(0.3) : Color.white.opacity(0.1))
                )
                .overlay(
                    Circle()
                        .stroke(isSelected ? Color.blue.opacity(0.5) : Color.white.opacity(0.2), lineWidth: 1)
                )
        }
        .buttonStyle(DreamButtonStyle())
    }
}

struct DreamButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
            .opacity(configuration.isPressed ? 0.8 : 1.0)
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}