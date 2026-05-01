struct ContentView: View {
    @State private var slots: [TimeSlot] = [
        TimeSlot(content: "Morning pages", createdAt: Calendar.current.date(byAdding: .day, value: -2, to: Date()) ?? Date(), lastTouched: Date()),
        TimeSlot(content: "Read Proust chapter", createdAt: Calendar.current.date(byAdding: .day, value: -4, to: Date()) ?? Date(), lastTouched: Date()),
        TimeSlot(content: "Call grandmother", createdAt: Calendar.current.date(byAdding: .day, value: -6, to: Date()) ?? Date(), lastTouched: Date()),
        TimeSlot(content: "Fix garden gate", createdAt: Calendar.current.date(byAdding: .day, value: -8, to: Date()) ?? Date(), lastTouched: Date()),
        TimeSlot(content: "", createdAt: Date(), lastTouched: Date()),
        TimeSlot(content: "", createdAt: Date(), lastTouched: Date()),
        TimeSlot(content: "", createdAt: Date(), lastTouched: Date()),
        TimeSlot(content: "", createdAt: Date(), lastTouched: Date())
    ]
    
    @State private var newItemText: String = ""
    @State private var selectedSlotIndex: Int? = nil
    
    var body: some View {
        ZStack {
            // Window sill background
            LinearGradient(
                colors: [
                    Color(red: 0.96, green: 0.95, blue: 0.93),
                    Color(red: 0.92, green: 0.90, blue: 0.86),
                    Color(red: 0.94, green: 0.92, blue: 0.88)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            
            // Subtle wood grain texture
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.88, green: 0.84, blue: 0.78).opacity(0.3),
                            Color.clear,
                            Color(red: 0.85, green: 0.81, blue: 0.75).opacity(0.2),
                            Color.clear
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .ignoresSafeArea()
            
            VStack(spacing: 24) {
                // Header
                VStack(spacing: 8) {
                    Text("Temporal Sill")
                        .font(.system(size: 28, weight: .light, design: .serif))
                        .foregroundColor(Color(red: 0.34, green: 0.25, blue: 0.18))
                    
                    Text("Items age gracefully in warm light")
                        .font(.system(size: 13, weight: .regular, design: .serif))
                        .foregroundColor(Color(red: 0.54, green: 0.43, blue: 0.32))
                        .opacity(0.8)
                }
                .padding(.top, 32)
                
                // Slots grid
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: 4), spacing: 16) {
                    ForEach(Array(slots.enumerated()), id: \.element.id) { index, slot in
                        WoodenSlot(slot: slot, index: index)
                            .frame(width: 140, height: 100)
                            .onTapGesture {
                                selectedSlotIndex = index
                                newItemText = slot.content
                            }
                    }
                }
                .padding(.horizontal, 40)
                
                // Input area
                if selectedSlotIndex != nil {
                    VStack(spacing: 12) {
                        TextField("What needs attention?", text: $newItemText)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 14, weight: .regular, design: .serif))
                            .frame(maxWidth: 300)
                            .onSubmit {
                                if let index = selectedSlotIndex {
                                    slots[index].content = newItemText
                                    if !newItemText.isEmpty && slots[index].ageInDays < 0.1 {
                                        slots[index].createdAt = Date()
                                    }
                                    slots[index].lastTouched = Date()
                                }
                                selectedSlotIndex = nil
                                newItemText = ""
                            }
                        
                        HStack(spacing: 12) {
                            Button("Save") {
                                if let index = selectedSlotIndex {
                                    slots[index].content = newItemText
                                    if !newItemText.isEmpty && slots[index].ageInDays < 0.1 {
                                        slots[index].createdAt = Date()
                                    }
                                    slots[index].lastTouched = Date()
                                }
                                selectedSlotIndex = nil
                                newItemText = ""
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(Color(red: 0.71, green: 0.56, blue: 0.42))
                            
                            Button("Cancel") {
                                selectedSlotIndex = nil
                                newItemText = ""
                            }
                            .buttonStyle(.bordered)
                        }
                        .font(.system(size: 12, weight: .medium, design: .serif))
                    }
                    .padding(20)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color(red: 0.97, green: 0.96, blue: 0.94))
                            .shadow(color: Color.black.opacity(0.1), radius: 8, x: 0, y: 4)
                    )
                    .transition(.scale.combined(with: .opacity))
                }
                
                Spacer()
            }
        }
        .frame(width: 640, height: 480)
        .animation(.easeInOut(duration: 0.3), value: selectedSlotIndex != nil)
    }
}