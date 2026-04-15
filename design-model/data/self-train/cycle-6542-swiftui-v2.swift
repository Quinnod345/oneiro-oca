struct ContentView: View {
    @State private var photos: [Photo] = []
    @State private var selectedPhoto: Photo?
    @State private var connections: [PhotoConnection] = []
    @State private var activeConnection: ActiveConnection?
    @State private var hoveredPhoto: Photo?
    @State private var viewScale: CGFloat = 1.0
    @State private var viewOffset: CGSize = .zero
    @State private var filterMode: FilterMode = .all
    @State private var draggedPhoto: Photo?
    
    enum FilterMode: String, CaseIterable {
        case all = "All"
        case recent = "Recent"
        case favorites = "Favorites"
        case albums = "Albums"
    }
    
    var filteredPhotos: [Photo] {
        switch filterMode {
        case .all:
            return photos
        case .recent:
            return photos.filter { $0.date > Date().addingTimeInterval(-7 * 24 * 60 * 60) }
        case .favorites:
            return photos.filter { $0.isFavorite }
        case .albums:
            return photos.filter { $0.albumId != nil }
        }
    }
    
    var body: some View {
        ZStack {
            Color(hex: "0A0A0A")
                .ignoresSafeArea()
            
            GeometryReader { geometry in
                ZStack {
                    ForEach(connections) { connection in
                        if let fromPhoto = photos.first(where: { $0.id == connection.fromId }),
                           let toPhoto = photos.first(where: { $0.id == connection.toId }) {
                            Path { path in
                                path.move(to: fromPhoto.position)
                                path.addLine(to: toPhoto.position)
                            }
                            .stroke(Color.white.opacity(0.1), lineWidth: 1)
                        }
                    }
                    
                    if let active = activeConnection,
                       let fromPhoto = photos.first(where: { $0.id == active.fromId }) {
                        Path { path in
                            path.move(to: fromPhoto.position)
                            path.addLine(to: active.currentPosition)
                        }
                        .stroke(Color.white.opacity(0.3), lineWidth: 1)
                    }
                    
                    ForEach(filteredPhotos) { photo in
                        PhotoNodeView(
                            photo: photo,
                            isSelected: selectedPhoto?.id == photo.id,
                            isHovered: hoveredPhoto?.id == photo.id,
                            scale: viewScale
                        )
                        .position(photo.position)
                        .onTapGesture {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                selectedPhoto = selectedPhoto?.id == photo.id ? nil : photo
                            }
                        }
                        .onHover { isHovering in
                            hoveredPhoto = isHovering ? photo : nil
                        }
                        .onDrag {
                            self.draggedPhoto = photo
                            return NSItemProvider(object: photo.id.uuidString as NSString)
                        }
                        .onDrop(of: [.text], isTargeted: nil) { providers in
                            guard let draggedPhoto = self.draggedPhoto,
                                  draggedPhoto.id != photo.id else { return false }
                            
                            withAnimation(.easeInOut(duration: 0.2)) {
                                connections.append(PhotoConnection(
                                    fromId: draggedPhoto.id,
                                    toId: photo.id
                                ))
                            }
                            return true
                        }
                    }
                }
                .offset(viewOffset)
                .scaleEffect(viewScale, anchor: .center)
                .onAppear {
                    generatePhotoLayout(in: geometry.size)
                }
                .gesture(
                    MagnificationGesture()
                        .onChanged { value in
                            viewScale = max(0.5, min(2.0, value))
                        }
                )
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            viewOffset = CGSize(
                                width: value.translation.width,
                                height: value.translation.height
                            )
                        }
                )
            }
            
            VStack {
                HStack {
                    ForEach(FilterMode.allCases, id: \.self) { mode in
                        FilterButton(
                            title: mode.rawValue,
                            isSelected: filterMode == mode
                        )
                        .onTapGesture {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                filterMode = mode
                            }
                        }
                    }
                    
                    Spacer()
                    
                    HStack(spacing: 16) {
                        Image(systemName: "minus")
                            .foregroundColor(.white.opacity(0.4))
                            .onTapGesture {
                                withAnimation {
                                    viewScale = max(0.5, viewScale - 0.1)
                                }
                            }
                        
                        Text("\(Int(viewScale * 100))%")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.white.opacity(0.4))
                            .frame(width: 40)
                        
                        Image(systemName: "plus")
                            .foregroundColor(.white.opacity(0.4))
                            .onTapGesture {
                                withAnimation {
                                    viewScale = min(2.0, viewScale + 0.1)
                                }
                            }
                    }
                }
                .padding()
                
                Spacer()
                
                if let selected = selectedPhoto {
                    PhotoDetailView(photo: selected)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
        .preferredColorScheme(.dark)
    }
    
    func generatePhotoLayout(in size: CGSize) {
        let sampleImages = ["photo1", "photo2", "photo3", "photo4", "photo5"]
        let count = Int.random(in: 15...25)
        
        for i in 0..<count {
            let photo = Photo(
                imageName: sampleImages.randomElement() ?? "photo1",
                position: CGPoint(
                    x: CGFloat.random(in: 100...size.width - 100),
                    y: CGFloat.random(in: 100...size.height - 100)
                ),
                date: Date().addingTimeInterval(-Double.random(in: 0...365 * 24 * 60 * 60)),
                isFavorite: Bool.random(),
                albumId: Bool.random() ? UUID() : nil
            )
            photos.append(photo)
        }
        
        // Create some initial connections
        for _ in 0..<5 {
            if photos.count > 1 {
                let fromIndex = Int.random(in: 0..<photos.count)
                let toIndex = Int.random(in: 0..<photos.count)
                if fromIndex != toIndex {
                    connections.append(PhotoConnection(
                        fromId: photos[fromIndex].id,
                        toId: photos[toIndex].id
                    ))
                }
            }
        }
    }
}

struct Photo: Identifiable {
    let id = UUID()
    let imageName: String
    var position: CGPoint
    let date: Date
    let isFavorite: Bool
    let albumId: UUID?
}

struct PhotoConnection: Identifiable {
    let id = UUID()
    let fromId: UUID
    let toId: UUID
}

struct ActiveConnection {
    let fromId: UUID
    var currentPosition: CGPoint
}

struct PhotoNodeView: View {
    let photo: Photo
    let isSelected: Bool
    let isHovered: Bool
    let scale: CGFloat
    
    var body: some View {
        ZStack {
            Circle()
                .fill(Color.white.opacity(0.05))
                .frame(width: 80, height: 80)
                .scaleEffect(isHovered ? 1.1 : 1.0)
            
            Image(systemName: "photo.fill")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 40, height: 40)
                .foregroundColor(.white.opacity(0.3))
            
            if isSelected {
                Circle()
                    .stroke(Color.white.opacity(0.8), lineWidth: 2)
                    .frame(width: 80, height: 80)
            }
        }
        .scaleEffect(1 / scale)
        .animation(.easeInOut(duration: 0.2), value: isHovered)
        .animation(.easeInOut(duration: 0.2), value: isSelected)
    }
}

struct FilterButton: View {
    let title: String
    let isSelected: Bool
    
    var body: some View {
        Text(title)
            .font(.system(size: 14, weight: .medium))
            .foregroundColor(isSelected ? .white : .white.opacity(0.4))
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(isSelected ? Color.white.opacity(0.1) : Color.clear)
            )
    }
}

struct PhotoDetailView: View {
    let photo: Photo
    
    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: "photo.fill")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 60, height: 60)
                .foregroundColor(.white.opacity(0.3))
            
            VStack(alignment: .leading, spacing: 4) {
                Text("Photo Details")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)
                
                Text(photo.date, style: .date)
                    .font(.system(size: 14))
                    .foregroundColor(.white.opacity(0.6))
                
                HStack(spacing: 12) {
                    if photo.isFavorite {
                        Label("Favorite", systemImage: "heart.fill")
                            .font(.system(size: 12))
                            .foregroundColor(.white.opacity(0.4))
                    }
                    
                    if photo.albumId != nil {
                        Label("In Album", systemImage: "square.stack.fill")
                            .font(.system(size: 12))
                            .foregroundColor(.white.opacity(0.4))
                    }
                }
            }
            
            Spacer()
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.white.opacity(0.05))
        )
        .padding()
    }
}

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (1, 1, 1, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}