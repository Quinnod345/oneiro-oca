struct ContentView: View {
    @StateObject private var store = ShelfStore()
    @State private var draggedItem: NSItemProvider?
    @State private var highlightedSlot: Int? = nil
    @State private var selectedType: ShelfItem.ItemType = .text
    @State private var inputText: String = ""
    
    private let customGradient = LinearGradient(
        colors: [Color(red: 0.15, green: 0.08, blue: 0.35), Color(red: 0.25, green: 0.15, blue: 0.45)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
    
    private let accentGradient = LinearGradient(
        colors: [Color(red: 0.6, green: 0.4, blue: 0.8), Color(red: 0.5, green: 0.3, blue: 0.7)],
        startPoint: .leading,
        endPoint: .trailing
    )
    
    var body: some View {
        VStack(spacing: 40) {
            VStack(spacing: 8) {
                Text("Digital Shelf")
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                    .tracking(-0.03)
                    .foregroundStyle(customGradient)
                
                Text("Curate your digital universe with style")
                    .font(.system(size: 15, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 32)
            
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 20) {
                    ForEach(store.items) { item in
                        ShelfCard(item: item, accentGradient: accentGradient) {
                            withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                                store.removeItem(item)
                            }
                        }
                    }
                    
                    DropZone(accentGradient: accentGradient) {
                        withAnimation(.spring(response: 0.6, dampingFraction: 0.7)) {
                            // Handle drop in zone
                        }
                    }
                    .frame(width: 180)
                }
                .padding(.horizontal, 32)
                .padding(.vertical, 24)
            }
            .frame(height: 180)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24))
            .overlay(
                RoundedRectangle(cornerRadius: 24)
                    .stroke(customGradient.opacity(0.2), lineWidth: 1)
            )
            .onDrop(of: [.text, .fileURL], isTargeted: nil) { providers, location in
                handleDrop(providers: providers)
                return true
            }
            
            VStack(spacing: 20) {
                Picker("Item Type", selection: $selectedType) {
                    ForEach(ShelfItem.ItemType.allCases, id: \.self) { type in
                        Text(type.rawValue.capitalized)
                            .tag(type)
                    }
                }
                .pickerStyle(SegmentedPickerStyle())
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                
                HStack(spacing: 16) {
                    TextField("Add your content...", text: $inputText)
                        .textFieldStyle(.plain)
                        .font(.system(size: 15, weight: .medium, design: .rounded))
                        .padding(.horizontal, 20)
                        .padding(.vertical, 16)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16)
                                .stroke(customGradient.opacity(0.3), lineWidth: 1)
                        )
                    
                    Button("Add") {
                        addItem()
                    }
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 16)
                    .background(inputText.isEmpty ? .gray.opacity(0.3) : accentGradient)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .disabled(inputText.isEmpty)
                    .animation(.easeInOut(duration: 0.2), value: inputText.isEmpty)
                }
            }
            .padding(.horizontal, 32)
            
            Spacer()
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            LinearGradient(
                colors: [Color(red: 0.95, green: 0.95, blue: 0.97), Color(red: 0.92, green: 0.92, blue: 0.95)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }
    
    private func addItem() {
        guard !inputText.isEmpty else { return }
        
        let newItem = ShelfItem(content: inputText, type: selectedType)
        
        withAnimation(.spring(response: 0.6, dampingFraction: 0.7)) {
            store.addItem(newItem)
        }
        
        inputText = ""
    }
    
    private func handleDrop(providers: [NSItemProvider]) -> Bool {
        guard let provider = providers.first else { return false }
        
        if provider.hasItemConformingToTypeIdentifier("public.file-url") {
            provider.loadItem(forTypeIdentifier: "public.file-url", options: nil) { item, error in
                if let data = item as? Data, let url = URL(dataRepresentation: data, relativeTo: nil) {
                    DispatchQueue.main.async {
                        let fileItem = ShelfItem(content: url.path, type: .file)
                        withAnimation(.spring(response: 0.6, dampingFraction: 0.7)) {
                            store.addItem(fileItem)
                        }
                    }
                }
            }
            return true
        } else if provider.hasItemConformingToTypeIdentifier("public.text") {
            provider.loadItem(forTypeIdentifier: "public.text", options: nil) { item, error in
                if let text = item as? String {
                    DispatchQueue.main.async {
                        let textType: ShelfItem.ItemType = text.hasPrefix("http") ? .url : .text
                        let textItem = ShelfItem(content: text, type: textType)
                        withAnimation(.spring(response: 0.6, dampingFraction: 0.7)) {
                            store.addItem(textItem)
                        }
                    }
                }
            }
            return true
        }
        
        return false
    }
}

struct ShelfCard: View {
    let item: ShelfItem
    let accentGradient: LinearGradient
    let onRemove: () -> Void
    @State private var isHovered = false
    
    var body: some View {
        VStack(spacing: 16) {
            HStack {
                ZStack {
                    Circle()
                        .fill(accentGradient.opacity(0.15))
                        .frame(width: 36, height: 36)
                    
                    Image(systemName: item.iconName)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(accentGradient)
                }
                
                Spacer()
                
                Button(action: onRemove) {
                    ZStack {
                        Circle()
                            .fill(.black.opacity(0.1))
                            .frame(width: 24, height: 24)
                        
                        Image(systemName: "xmark")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.primary)
                    }
                }
                .buttonStyle(.plain)
                .opacity(isHovered ? 1 : 0)
                .animation(.easeInOut(duration: 0.2), value: isHovered)
            }
            
            VStack(alignment: .leading, spacing: 6) {
                Text(item.displayContent)
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)
                    .foregroundStyle(.primary)
                
                Text(item.type.rawValue.uppercased())
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(accentGradient)
                    .tracking(0.5)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            
            Spacer()
        }
        .padding(20)
        .frame(width: 180, height: 140)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(accentGradient.opacity(0.2), lineWidth: 1)
        )
        .scaleEffect(isHovered ? 1.05 : 1.0)
        .shadow(color: .black.opacity(isHovered ? 0.15 : 0.05), radius: isHovered ? 12 : 6, x: 0, y: isHovered ? 8 : 4)
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.2)) {
                isHovered = hovering
            }
        }
    }
}

struct DropZone: View {
    let accentGradient: LinearGradient
    let onDrop: () -> Void
    @State private var isTargeted = false
    
    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(accentGradient.opacity(0.1))
                    .frame(width: 48, height: 48)
                
                Image(systemName: "plus")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(accentGradient)
            }
            
            Text("Drop Here")
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundStyle(accentGradient)
            
            Text("Add new content")
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
        }
        .frame(height: 140)
        .frame(maxWidth: .infinity)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .strokeBorder(style: StrokeStyle(lineWidth: 2, dash: [8, 4]))
                .foregroundStyle(accentGradient.opacity(isTargeted ? 0.8 : 0.3))
        )
        .scaleEffect(isTargeted ? 1.05 : 1.0)
        .animation(.easeInOut(duration: 0.2), value: isTargeted)
        .onDrop(of: [.text, .fileURL], isTargeted: $isTargeted) { providers in
            onDrop()
            return true
        }
    }
}