struct ContentView: View {
    @StateObject private var store = ShelfStore()
    @State private var draggedItem: NSItemProvider?
    @State private var highlightedSlot: Int? = nil
    @State private var selectedType: ShelfItem.ItemType = .text
    @State private var inputText: String = ""
    
    var body: some View {
        VStack(spacing: 20) {
            VStack(spacing: 4) {
                Text("Digital Shelf")
                    .font(.system(size: 28, weight: .medium, design: .default))
                    .tracking(-0.02)
                    .foregroundStyle(.primary)
                
                Text("Organize your digital content")
                    .font(.system(size: 13, weight: .regular, design: .default))
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 16)
            
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 12) {
                    ForEach(store.items) { item in
                        ShelfCard(item: item) {
                            withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                                store.removeItem(item)
                            }
                        }
                    }
                    
                    DropZone {
                        withAnimation(.spring(response: 0.6, dampingFraction: 0.7)) {
                            // Handle drop in zone
                        }
                    }
                    .frame(width: 160)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
            }
            .frame(height: 140)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
            .onDrop(of: [.text, .fileURL], isTargeted: nil) { providers, location in
                handleDrop(providers: providers)
                return true
            }
            
            VStack(spacing: 12) {
                Picker("Item Type", selection: $selectedType) {
                    ForEach(ShelfItem.ItemType.allCases, id: \.self) { type in
                        Text(type.rawValue.capitalized)
                            .tag(type)
                    }
                }
                .pickerStyle(SegmentedPickerStyle())
                
                HStack(spacing: 12) {
                    TextField("Add content...", text: $inputText)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 13, weight: .regular, design: .default))
                    
                    Button("Add") {
                        addItem()
                    }
                    .buttonStyle(.borderedProminent)
                    .font(.system(size: 13, weight: .medium, design: .default))
                    .disabled(inputText.isEmpty)
                }
            }
            .padding(.horizontal, 20)
            
            Spacer()
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.regularMaterial)
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
    let onRemove: () -> Void
    @State private var isHovered = false
    
    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Image(systemName: item.iconName)
                    .font(.title2)
                    .foregroundStyle(.blue)
                
                Spacer()
                
                Button(action: onRemove) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary, .background)
                }
                .buttonStyle(.plain)
                .opacity(isHovered ? 1 : 0)
            }
            
            VStack(alignment: .leading, spacing: 4) {
                Text(item.displayContent)
                    .font(.system(size: 13, weight: .medium, design: .default))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                
                Text(item.type.rawValue.capitalized)
                    .font(.system(size: 11, weight: .regular, design: .default))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            
            Spacer()
        }
        .padding(16)
        .frame(width: 160, height: 120)
        .background(.background.opacity(0.8), in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(.separator.opacity(0.5), lineWidth: 1)
        )
        .scaleEffect(isHovered ? 1.02 : 1.0)
        .shadow(color: .black.opacity(isHovered ? 0.12 : 0.04), radius: isHovered ? 8 : 3, x: 0, y: isHovered ? 4 : 2)
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.2)) {
                isHovered = hovering
            }
        }
        .contextMenu {
            Button("Copy") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(item.content, forType: .string)
            }
            
            if item.type == .url, let url = URL(string: item.content) {
                Button("Open URL") {
                    NSWorkspace.shared.open(url)
                }
            }
            
            Divider()
            
            Button("Remove") {
                onRemove()
            }
        }
    }
}

struct DropZone: View {
    let onDrop: () -> Void
    @State private var isTargeted = false
    
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "plus.circle.dashed")
                .font(.title2)
                .foregroundStyle(.tertiary)
            
            Text("Drop here")
                .font(.system(size: 12, weight: .regular, design: .default))
                .foregroundStyle(.secondary)
        }
        .frame(height: 120)
        .frame(maxWidth: .infinity)
        .background(.background.opacity(isTargeted ? 0.8 : 0.4), in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(.blue.opacity(isTargeted ? 0.8 : 0.3), lineWidth: 2, dashes: [5])
        )
        .scaleEffect(isTargeted ? 1.02 : 1.0)
        .onDrop(of: [.text, .fileURL], isTargeted: $isTargeted) { providers, location in
            onDrop()
            return true
        }
    }
}