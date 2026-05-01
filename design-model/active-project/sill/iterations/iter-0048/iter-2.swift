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
    @State private var showingInput = false
    
    var body: some View {
        VStack(spacing: 32) {
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.system(size: 24, weight: .medium))
                        .foregroundStyle(Color(.displayP3, red: 0.8, green: 0.5, blue: 0.3))
                    
                    Text("Temporal Sill")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(.primary)
                }
                
                Text("Items age gracefully in warm light")
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 24)
            
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: 4), spacing: 16) {
                ForEach(Array(slots.enumerated()), id: \.element.id) { index, slot in
                    WoodenSlotView(slot: slot, index: index)
                        .frame(width: 140, height: 100)
                        .onTapGesture {
                            selectedSlotIndex = index
                            newItemText = slot.content
                            showingInput = true
                        }
                }
            }
            .padding(.horizontal, 32)
            
            if showingInput, let selectedIndex = selectedSlotIndex {
                VStack(spacing: 16) {
                    Text("Editing slot \(selectedIndex + 1)")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.secondary)
                    
                    TextField("What needs attention?", text: $newItemText)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 14, weight: .regular))
                        .frame(maxWidth: 300)
                        .onSubmit {
                            saveAndClose()
                        }
                    
                    HStack(spacing: 16) {
                        Button("Save") {
                            saveAndClose()
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Color(.displayP3, red: 0.8, green: 0.5, blue: 0.3))
                        .keyboardShortcut(.return)
                        
                        Button("Cancel") {
                            showingInput = false
                            selectedSlotIndex = nil
                            newItemText = ""
                        }
                        .buttonStyle(.bordered)
                        .keyboardShortcut(.escape)
                    }
                    .font(.system(size: 14, weight: .medium))
                }
                .padding(24)
                .background(
                    LinearGradient(
                        colors: [
                            Color(.displayP3, red: 0.96, green: 0.94, blue: 0.88),
                            Color(.displayP3, red: 0.94, green: 0.89, blue: 0.82)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .cornerRadius(12)
                .shadow(color: .black.opacity(0.1), radius: 8, x: 0, y: 4)
            }
            
            Spacer()
        }
        .frame(minWidth: 640, minHeight: 520)
        .background(
            LinearGradient(
                colors: [
                    Color(.displayP3, red: 0.98, green: 0.96, blue: 0.90),
                    Color(.displayP3, red: 0.96, green: 0.91, blue: 0.83),
                    Color(.displayP3, red: 0.94, green: 0.87, blue: 0.76)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .onAppear {
            NSApp.windows.first?.styleMask.remove(.resizable)
        }
    }
    
    private func saveAndClose() {
        if let index = selectedSlotIndex {
            slots[index].content = newItemText
            if !newItemText.isEmpty && slots[index].ageInDays < 0.1 {
                slots[index].createdAt = Date()
            }
            slots[index].lastTouched = Date()
        }
        showingInput = false
        selectedSlotIndex = nil
        newItemText = ""
    }
}

struct WoodenSlotView: View {
    let slot: TimeSlot
    let index: Int
    
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(
                LinearGradient(
                    colors: [
                        Color(.displayP3, red: 0.85, green: 0.67, blue: 0.45),
                        Color(.displayP3, red: 0.75, green: 0.58, blue: 0.38),
                        Color(.displayP3, red: 0.70, green: 0.53, blue: 0.33)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(
                        LinearGradient(
                            colors: [
                                Color(.displayP3, red: 0.60, green: 0.45, blue: 0.25),
                                Color(.displayP3, red: 0.65, green: 0.48, blue: 0.28)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
            )
            .shadow(color: .black.opacity(0.2), radius: 4, x: 0, y: 2)
            .overlay(
                VStack(spacing: 4) {
                    if !slot.content.isEmpty {
                        Text(slot.content)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.center)
                            .lineLimit(3)
                            .opacity(slot.agingOpacity)
                            .colorMultiply(Color(.displayP3, red: 1.0 - slot.sepiaIntensity * 0.3, green: 1.0 - slot.sepiaIntensity * 0.1, blue: 1.0 - slot.sepiaIntensity * 0.5))
                        
                        if slot.ageInDays > 1 {
                            Text("\(Int(slot.ageInDays))d ago")
                                .font(.system(size: 9, weight: .regular))
                                .foregroundStyle(.secondary)
                                .opacity(0.7)
                        }
                    } else {
                        Image(systemName: "plus")
                            .font(.system(size: 20, weight: .light))
                            .foregroundStyle(Color(.displayP3, red: 0.8, green: 0.5, blue: 0.3).opacity(0.6))
                    }
                }
                .padding(8)
            )
            .scaleEffect(slot.content.isEmpty ? 0.95 : 1.0)
            .animation(.easeInOut(duration: 0.3), value: slot.content.isEmpty)
    }
}