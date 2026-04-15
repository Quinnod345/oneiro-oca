import Foundation
import Combine

struct OCAStatus: Codable {
    let crmScores: CRMScores?
    let emotion: EmotionState?
    let activeDream: ActiveDream?
    let timestamp: Double?

    enum CodingKeys: String, CodingKey {
        case crmScores = "crm_scores"
        case emotion
        case activeDream = "active_dream"
        case timestamp
    }
}

struct CRMScores: Codable {
    let overall: Double?
    let prediction: Double?
    let metacognition: Double?
    let causal: Double?
    let counterfactual: Double?
    let lovelace: Double?
    let dimensions: [String: Double]?
}

struct EmotionState: Codable {
    let valence: Double?
    let arousal: Double?
    let dominance: Double?
    let label: String?
    let intensity: Double?
}

struct ActiveDream: Codable {
    let id: String?
    let title: String?
    let status: String?
    let progress: Double?
    let startedAt: Double?

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case status
        case progress
        case startedAt = "started_at"
    }
}

@MainActor
class OneiroClient: ObservableObject {
    static let shared = OneiroClient()

    @Published var status: OCAStatus?
    @Published var isConnected: Bool = false
    @Published var lastError: String?
    @Published var lastUpdated: Date?

    private let baseURL = URL(string: "http://localhost:3333")!
    private let pollInterval: TimeInterval = 5.0
    private var pollTask: Task<Void, Never>?
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    private init() {}

    func startPolling() {
        stopPolling()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.fetchStatus()
                try? await Task.sleep(nanoseconds: UInt64(5_000_000_000))
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    func fetchStatus() async {
        let url = baseURL.appendingPathComponent("status")
        var request = URLRequest(url: url)
        request.timeoutInterval = 4.0
        request.cachePolicy = .reloadIgnoringLocalCacheData

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                await MainActor.run {
                    self.isConnected = false
                    self.lastError = "Non-200 response"
                }
                return
            }
            let decoded = try JSONDecoder().decode(OCAStatus.self, from: data)
            await MainActor.run {
                self.status = decoded
                self.isConnected = true
                self.lastError = nil
                self.lastUpdated = Date()
            }
        } catch let urlError as URLError {
            await MainActor.run {
                self.isConnected = false
                self.lastError = urlError.localizedDescription
            }
        } catch {
            await MainActor.run {
                self.isConnected = false
                self.lastError = "Decode error: \(error.localizedDescription)"
            }
        }
    }

    var crmOverall: Double? { status?.crmScores?.overall }
    var crmDimensions: [String: Double] { status?.crmScores?.dimensions ?? [:] }
    var emotionLabel: String { status?.emotion?.label ?? "unknown" }
    var emotionValence: Double { status?.emotion?.valence ?? 0.0 }
    var emotionArousal: Double { status?.emotion?.arousal ?? 0.0 }
    var dreamTitle: String? { status?.activeDream?.title }
    var dreamStatus: String? { status?.activeDream?.status }
    var dreamProgress: Double { status?.activeDream?.progress ?? 0.0 }
    var hasDream: Bool { status?.activeDream?.id != nil }
}