struct ContentView: View {
    @State private var items: [GroceryItem] = [
        GroceryItem(name: "Tomatoes", category: .produce, quantity: 6, isStaple: false),
        GroceryItem(name: "Bread", category: .grains, quantity: 1, isStaple: true),
        GroceryItem(name: "Milk", category: .dairy, quantity: 1, isStaple: true),
        GroceryItem(name: "Eggs", category: .dairy, quantity: 12, isStaple: true),
        GroceryItem(name: "Apples", category: .produce, quantity: 5, isStaple: false),
        GroceryItem(name: "Chicken", category: .protein, quantity: 2, isStaple: false)
    ]
    @State private var selectedCategory: GroceryCategory? = nil
    @State private var searchText = ""
    @State private var showingAddItem = false
    
    var filteredItems: [GroceryItem] {
        items.filter { item in
            let matchesCategory = selectedCategory == nil || item.category == selectedCategory
            let matchesSearch = searchText.isEmpty || item.name.localizedCaseInsensitiveContains(searchText)
            return matchesCategory && matchesSearch
        }
    }
    
    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Search Bar
                HStack {
                    Image(systemName: "magnifyingglass")
                        .foregroundColor(.secondary)
                    TextField("Search groceries", text: $searchText)
                        .textFieldStyle(PlainTextFieldStyle())
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(10)
                .padding(.horizontal)
                .padding(.top)
                
                // Category Filter
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        CategoryChip(
                            title: "All",
                            isSelected: selectedCategory == nil,
                            action: { selectedCategory = nil }
                        )
                        
                        ForEach(GroceryCategory.allCases, id: \.self) { category in
                            CategoryChip(
                                title: category.displayName,
                                icon: category.icon,
                                isSelected: selectedCategory == category,
                                action: { selectedCategory = category }
                            )
                        }
                    }
                    .padding(.horizontal)
                }
                .padding(.vertical, 8)
                
                // Items Grid
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 160))], spacing: 16) {
                        ForEach(filteredItems) { item in
                            ItemCard(item: item, onUpdate: updateItem)
                        }
                    }
                    .padding()
                }
                
                Spacer()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Grocery List")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showingAddItem = true }) {
                        Image(systemName: "plus.circle.fill")
                            .font(.title2)
                    }
                }
            }
        }
        .sheet(isPresented: $showingAddItem) {
            AddItemView(items: $items)
        }
    }
    
    func updateItem(_ item: GroceryItem) {
        if let index = items.firstIndex(where: { $0.id == item.id }) {
            items[index] = item
        }
    }
}

struct CategoryChip: View {
    let title: String
    var icon: String? = nil
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            HStack {
                if let icon = icon {
                    Image(systemName: icon)
                }
                Text(title)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(isSelected ? Color.accentColor : Color(.systemGray5))
            .foregroundColor(isSelected ? .white : .primary)
            .cornerRadius(20)
        }
    }
}

struct ItemCard: View {
    let item: GroceryItem
    let onUpdate: (GroceryItem) -> Void
    @State private var isPressed = false
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: item.category.icon)
                    .font(.title2)
                    .foregroundColor(item.category.color)
                
                Spacer()
                
                if item.isStaple {
                    Image(systemName: "star.fill")
                        .font(.caption)
                        .foregroundColor(.yellow)
                }
            }
            
            Text(item.name)
                .font(.headline)
                .lineLimit(1)
            
            HStack {
                Text("Qty: \(item.quantity)")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                
                Spacer()
                
                HStack(spacing: 4) {
                    Button(action: { 
                        var updated = item
                        updated.quantity = max(0, item.quantity - 1)
                        onUpdate(updated)
                    }) {
                        Image(systemName: "minus.circle")
                    }
                    
                    Button(action: { 
                        var updated = item
                        updated.quantity += 1
                        onUpdate(updated)
                    }) {
                        Image(systemName: "plus.circle")
                    }
                }
                .font(.title3)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: Color.black.opacity(0.05), radius: 5, x: 0, y: 2)
        .scaleEffect(isPressed ? 0.95 : 1)
        .onTapGesture {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                isPressed = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    isPressed = false
                }
            }
        }
    }
}

struct AddItemView: View {
    @Binding var items: [GroceryItem]
    @State private var name = ""
    @State private var category: GroceryCategory = .produce
    @State private var quantity = 1
    @State private var isStaple = false
    @Environment(\.dismiss) var dismiss
    
    var body: some View {
        NavigationView {
            Form {
                Section("Item Details") {
                    TextField("Item name", text: $name)
                    
                    Picker("Category", selection: $category) {
                        ForEach(GroceryCategory.allCases, id: \.self) { cat in
                            Label(cat.displayName, systemImage: cat.icon)
                                .tag(cat)
                        }
                    }
                    
                    Stepper("Quantity: \(quantity)", value: $quantity, in: 1...99)
                    
                    Toggle("Staple item", isOn: $isStaple)
                }
            }
            .navigationTitle("Add Item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Add") {
                        let newItem = GroceryItem(
                            name: name,
                            category: category,
                            quantity: quantity,
                            isStaple: isStaple
                        )
                        items.append(newItem)
                        dismiss()
                    }
                    .disabled(name.isEmpty)
                }
            }
        }
    }
}

struct GroceryItem: Identifiable {
    let id = UUID()
    var name: String
    var category: GroceryCategory
    var quantity: Int
    var isStaple: Bool
}

enum GroceryCategory: String, CaseIterable {
    case produce, dairy, grains, protein, pantry
    
    var displayName: String {
        switch self {
        case .produce: return "Produce"
        case .dairy: return "Dairy"
        case .grains: return "Grains"
        case .protein: return "Protein"
        case .pantry: return "Pantry"
        }
    }
    
    var icon: String {
        switch self {
        case .produce: return "leaf"
        case .dairy: return "drop"
        case .grains: return "square.grid.3x1.below.line.grid.1x2"
        case .protein: return "fish"
        case .pantry: return "cabinet"
        }
    }
    
    var color: Color {
        switch self {
        case .produce: return .green
        case .dairy: return .blue
        case .grains: return .orange
        case .protein: return .red
        case .pantry: return .purple
        }
    }
}