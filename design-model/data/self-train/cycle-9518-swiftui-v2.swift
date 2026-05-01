struct ContentView: View {
    @State private var leftChoice = Choice(name: "Choice A", isLeft: true)
    @State private var rightChoice = Choice(name: "Choice B", isLeft: false)
    @State private var selectedChoice: UUID?
    @State private var isPro = true
    @State private var winner: UUID?
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Choose Your Side")
                    .font(.largeTitle)
                    .fontWeight(.bold)
                
                Spacer()
                
                Toggle("Pro", isOn: $isPro)
                    .toggleStyle(.switch)
            }
            .padding()
            .background(.thinMaterial)
            
            // Main content
            GeometryReader { geometry in
                HStack(spacing: 0) {
                    // Left choice
                    ChoiceCard(
                        choice: leftChoice,
                        isSelected: selectedChoice == leftChoice.id,
                        isWinner: winner == leftChoice.id,
                        geometry: geometry
                    )
                    .onTapGesture {
                        withAnimation(.spring()) {
                            selectedChoice = leftChoice.id
                        }
                    }
                    
                    // Divider
                    Rectangle()
                        .fill(Color.secondary.opacity(0.2))
                        .frame(width: 1)
                    
                    // Right choice
                    ChoiceCard(
                        choice: rightChoice,
                        isSelected: selectedChoice == rightChoice.id,
                        isWinner: winner == rightChoice.id,
                        geometry: geometry
                    )
                    .onTapGesture {
                        withAnimation(.spring()) {
                            selectedChoice = rightChoice.id
                        }
                    }
                }
            }
            
            // Action buttons
            HStack(spacing: 20) {
                Button(action: {
                    withAnimation(.spring()) {
                        winner = selectedChoice
                    }
                }) {
                    Label("Confirm", systemImage: "checkmark.circle.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(selectedChoice == nil)
                
                Button(action: {
                    withAnimation(.spring()) {
                        selectedChoice = nil
                        winner = nil
                    }
                }) {
                    Label("Reset", systemImage: "arrow.clockwise")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
    }
}

struct Choice: Identifiable {
    let id = UUID()
    var name: String
    var isLeft: Bool
}

struct ChoiceCard: View {
    let choice: Choice
    let isSelected: Bool
    let isWinner: Bool
    let geometry: GeometryProxy
    
    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            
            // Icon
            Image(systemName: isWinner ? "crown.fill" : (choice.isLeft ? "a.circle.fill" : "b.circle.fill"))
                .font(.system(size: 80))
                .foregroundStyle(isWinner ? .yellow : (isSelected ? .accentColor : .secondary))
                .scaleEffect(isSelected ? 1.1 : 1.0)
                .animation(.spring(response: 0.3), value: isSelected)
            
            // Name
            Text(choice.name)
                .font(.title2)
                .fontWeight(.semibold)
                .foregroundStyle(isSelected ? .primary : .secondary)
            
            // Selection indicator
            if isSelected {
                HStack(spacing: 4) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.footnote)
                    Text("Selected")
                        .font(.footnote)
                        .fontWeight(.medium)
                }
                .foregroundStyle(.accentColor)
                .transition(.scale.combined(with: .opacity))
            }
            
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(isSelected ? Color.accentColor.opacity(0.1) : Color.clear)
                .animation(.easeInOut(duration: 0.2), value: isSelected)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(
                    isWinner ? Color.yellow : (isSelected ? Color.accentColor : Color.clear),
                    lineWidth: isWinner ? 3 : 2
                )
                .animation(.easeInOut(duration: 0.2), value: isSelected)
                .animation(.easeInOut(duration: 0.3), value: isWinner)
        )
        .padding()
    }
}