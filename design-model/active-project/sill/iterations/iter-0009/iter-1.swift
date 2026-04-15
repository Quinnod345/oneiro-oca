struct ContentView: View {
    @StateObject private var store = ShelfStore()
    @State private var draggedItem: NSItemProvider?
    @State private var highlightedSlot: Int? = nil
    @State private var selectedType: ShelfItem.ItemType = .text
    @State private var inputText: String = ""
    
    private let maxSlots = 8
    
    var body: some View {
        VStack(spacing: 24) {
            Text("Digital Shelf")
                .font(.largeTitle)
                .fontWeight(.bold)
                .fontDesign(.rounded)
                .foregroundStyle(.primary)
                .padding(.top)
            
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(120), spacing: 16), count: 4), spacing: 16) {
                ForEach(0..<maxSlots, id: \.self) { index in
                    let item = index < store.items.count ? store.items[index] : nil
                    
                    ShelfSlot(
                        index: index,
                        item: item,
                        isHighlighted: highlightedSlot == index,
                        onRemove: {
                            if item != nil {
                                withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                                    store.removeItem(at: index)
                                }
                            }
                        }
                    )
                }
            }
            .padding()
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
            .onDrop(of: [.text, .fileURL], isTargeted: nil) { providers, location in
                handleDrop(providers: providers)
                return true
            }
            
            VStack(spacing: 16) {
                Picker("Item Type", selection: $selectedType) {
                    ForEach(ShelfItem.ItemType.allCases, id: \.self) { type in
                        Text(type.rawValue.capitalized)
                            .tag(type)
                    }
                }
                .pickerStyle(SegmentedPickerStyle())
                .fontDesign(.rounded)
                
                HStack {
                    TextField("Add content...", text: $inputText)
                        .textFieldStyle(.roundedBorder)
                        .font(.body)
                        .fontDesign(.rounded)
                    
                    Button("Add") {
                        addItem()
                    }
                    .buttonStyle(.borderedProminent)
                    .font(.headline)
                    .fontWeight(.medium)
                    .disabled(inputText.isEmpty)
                }
            }
            .padding(.horizontal, 20)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.regularMaterial)
        .onChange(of: draggedItem) { item in
            if let item = item {
                handleItemProvider(item)
            }
        }
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
    
    private func handleItemProvider(_ provider: NSItemProvider) {
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
        }
    }
}