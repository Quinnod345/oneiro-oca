struct ContentView: View {
    @State private var vaults: [EmotionalVault] = [
        EmotionalVault(personName: "Sarah", balance: -8500, memories: [
            Memory(type: .joy, intensity: 0.7, fragment: "That summer we drove to the coast"),
            Memory(type: .anger, intensity: 0.9, fragment: "The argument about moving away"),
            Memory(type: .regret, intensity: 0.8, fragment: "Never said goodbye properly")
        ]),
        EmotionalVault(personName: "Marcus", balance: -3200, memories: [
            Memory(type: .joy, intensity: 0.6, fragment: "Building that treehouse together"),
            Memory(type: .regret, intensity: 0.5, fragment: "Lost touch after college")
        ]),
        EmotionalVault(personName: "Elena", balance: -12000, memories: [
            Memory(type: .anger, intensity: 0.8, fragment: "The betrayal still stings"),
            Memory(type: .joy, intensity: 0.4, fragment: "Before everything changed"),
            Memory(type: .regret, intensity: 0.9, fragment: "Could have handled it better")
        ])
    ]
    
    @State private var selectedVault: UUID?
    @State private var withdrawnMemories: [WithdrawnMemory] = []
    @State private var ledgerBalance: Double = 0
    
    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                
                if selectedVault == nil {
                    VaultListView(vaults: vaults, selectedVault: $selectedVault)
                        .transition(.opacity.combined(with: .scale(scale: 0.95)))
                } else if let selectedId = selectedVault,
                          let vault = vaults.first(where: { $0.id == selectedId }) {
                    VaultDetailView(
                        vault: vault,
                        selectedVault: $selectedVault,
                        withdrawnMemories: $withdrawnMemories,
                        ledgerBalance: $ledgerBalance,
                        vaults: $vaults
                    )
                    .transition(.opacity.combined(with: .scale(scale: 1.05)))
                }
            }
            .animation(.easeInOut(duration: 0.4), value: selectedVault)
        }
        .preferredColorScheme(.dark)
    }
}

struct VaultListView: View {
    let vaults: [EmotionalVault]
    @Binding var selectedVault: UUID?
    
    var body: some View {
        VStack(spacing: 24) {
            Text("Emotional Vaults")
                .font(.system(size: 32, weight: .light, design: .default))
                .foregroundColor(.white.opacity(0.9))
                .padding(.top, 40)
            
            Text("Outstanding balances")
                .font(.system(size: 15, weight: .regular))
                .foregroundColor(.gray.opacity(0.6))
            
            ScrollView {
                VStack(spacing: 16) {
                    ForEach(vaults) { vault in
                        Button {
                            selectedVault = vault.id
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(vault.personName)
                                        .font(.system(size: 20, weight: .medium))
                                        .foregroundColor(.white)
                                    
                                    Text("\(vault.memories.count) memories")
                                        .font(.system(size: 14))
                                        .foregroundColor(.gray.opacity(0.6))
                                }
                                
                                Spacer()
                                
                                Text(String(format: "$%.0f", abs(vault.balance)))
                                    .font(.system(size: 22, weight: .semibold, design: .monospaced))
                                    .foregroundColor(Color(red: 1.0, green: 0.3, blue: 0.3))
                            }
                            .padding(24)
                            .background(
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(Color.white.opacity(0.05))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 12)
                                            .stroke(Color.white.opacity(0.1), lineWidth: 1)
                                    )
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
        }
        .frame(maxWidth: 500)
    }
}

struct VaultDetailView: View {
    let vault: EmotionalVault
    @Binding var selectedVault: UUID?
    @Binding var withdrawnMemories: [WithdrawnMemory]
    @Binding var ledgerBalance: Double
    @Binding var vaults: [EmotionalVault]
    
    @State private var selectedMemory: UUID?
    @State private var showingWithdrawal = false
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Button {
                    selectedVault = nil
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 16, weight: .medium))
                        Text("Back")
                            .font(.system(size: 16))
                    }
                    .foregroundColor(.gray)
                }
                .buttonStyle(.plain)
                
                Spacer()
                
                Text(vault.personName)
                    .font(.system(size: 24, weight: .medium))
                    .foregroundColor(.white)
                
                Spacer()
                
                Text(String(format: "$%.0f", abs(vault.balance)))
                    .font(.system(size: 20, weight: .semibold, design: .monospaced))
                    .foregroundColor(Color(red: 1.0, green: 0.3, blue: 0.3))
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            .background(Color.black.opacity(0.5))
            
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(vault.memories) { memory in
                        MemoryCard(
                            memory: memory,
                            isSelected: selectedMemory == memory.id,
                            onTap: {
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    selectedMemory = memory.id
                                    showingWithdrawal = true
                                }
                            }
                        )
                    }
                }
                .padding(20)
            }
            
            if showingWithdrawal, let memoryId = selectedMemory,
               let memory = vault.memories.first(where: { $0.id == memoryId }) {
                VStack(spacing: 20) {
                    Text("Withdraw this memory?")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundColor(.white)
                    
                    Text("Value: $\(Int(memory.intensity * 1000))")
                        .font(.system(size: 16, design: .monospaced))
                        .foregroundColor(.gray)
                    
                    HStack(spacing: 16) {
                        Button {
                            showingWithdrawal = false
                            selectedMemory = nil
                        } label: {
                            Text("Cancel")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(.gray)
                                .frame(width: 100)
                                .padding(.vertical, 12)
                                .background(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(Color.gray.opacity(0.3), lineWidth: 1)
                                )
                        }
                        .buttonStyle(.plain)
                        
                        Button {
                            withdrawMemory(memory, from: vault)
                        } label: {
                            Text("Withdraw")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(.black)
                                .frame(width: 100)
                                .padding(.vertical, 12)
                                .background(
                                    RoundedRectangle(cornerRadius: 8)
                                        .fill(Color.white)
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(24)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color.black.opacity(0.8))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16)
                                .stroke(Color.white.opacity(0.1), lineWidth: 1)
                        )
                )
                .padding(20)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .frame(maxWidth: 600)
    }
    
    func withdrawMemory(_ memory: Memory, from vault: EmotionalVault) {
        let value = memory.intensity * 1000
        
        withAnimation(.easeOut(duration: 0.6)) {
            withdrawnMemories.append(WithdrawnMemory(memory: memory, dissolveTime: Date().addingTimeInterval(3)))
            ledgerBalance += value
            
            if let vaultIndex = vaults.firstIndex(where: { $0.id == vault.id }) {
                vaults[vaultIndex].balance += value
                vaults[vaultIndex].memories.removeAll { $0.id == memory.id }
            }
            
            showingWithdrawal = false
            selectedMemory = nil
        }
    }
}

struct MemoryCard: View {
    let memory: Memory
    let isSelected: Bool
    let onTap: () -> Void
    
    var memoryColor: Color {
        switch memory.type {
        case .joy: return Color.yellow.opacity(0.8)
        case .anger: return Color.red.opacity(0.8)
        case .regret: return Color.blue.opacity(0.8)
        }
    }
    
    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 16) {
                Circle()
                    .fill(memoryColor)
                    .frame(width: 8, height: 8)
                
                Text(memory.fragment)
                    .font(.system(size: 16))
                    .foregroundColor(.white.opacity(0.9))
                    .multilineTextAlignment(.leading)
                
                Spacer()
                
                Text("$\(Int(memory.intensity * 1000))")
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundColor(.gray)
            }
            .padding(20)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(isSelected ? Color.white.opacity(0.08) : Color.white.opacity(0.03))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(isSelected ? Color.white.opacity(0.2) : Color.white.opacity(0.05), lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
    }
}

struct EmotionalVault: Identifiable {
    let id = UUID()
    let personName: String
    var balance: Double
    var memories: [Memory]
}

struct Memory: Identifiable {
    let id = UUID()
    let type: MemoryType
    let intensity: Double
    let fragment: String
}

enum MemoryType {
    case joy, anger, regret
}

struct WithdrawnMemory: Identifiable {
    let id = UUID()
    let memory: Memory
    let dissolveTime: Date
}