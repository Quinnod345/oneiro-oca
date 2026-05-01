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
                        .foregroundStyle(.accent)
                    
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
                    WoodenSlot(slot: slot, index: index)
                        .frame(width: 140, height: 100)
                        .onTapGesture {
                            selectedSlotIndex = index
                            newItemText = slot.content
                            showingInput = true
                        }
                }
            }
            .padding(.horizontal, 32)
            
            Spacer()
        }
        .frame(minWidth: 640, minHeight: 520)
        .background(.regularMaterial, in: Rectangle())
        .sheet(isPresented: $showingInput) {
            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Image(systemName: "square.and.pencil")
                        .font(.system(size: 32, weight: .light))
                        .foregroundStyle(.accent)
                    
                    Text("What needs attention?")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(.primary)
                }
                
                TextField("Enter your item", text: $newItemText)
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
            .padding(32)
            .frame(width: 400, height: 240)
            .background(.regularMaterial)
        }
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