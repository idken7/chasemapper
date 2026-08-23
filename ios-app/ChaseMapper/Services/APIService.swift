import Foundation
import CoreLocation

// MARK: - Server Configuration

/// Not actor-isolated so it can be used as a default parameter value from any context.
enum ServerConfig {
    static func defaultBaseURL() -> URL {
        if let saved = UserDefaults.standard.string(forKey: "serverURL"),
           let url = URL(string: saved) {
            return url
        }
        return URL(string: "http://127.0.0.1:5001")!
    }
}

// MARK: - API Service

@MainActor
final class APIService {
    static let shared = APIService()
    
    // MARK: - Configuration
    
    private var baseURL: URL
    private var apiKey: String?
    private let session: URLSession
    private let retryPolicy: RetryPolicy
    private let circuitBreakerPauseSeconds: TimeInterval = 30
    private let decoder = JSONDecoder()

    // MARK: - State Management

    private var circuitBreakers: [String: CircuitBreakerState] = [:]
    private var failureCounters: [String: Int] = [:]
    private let stateQueue = DispatchQueue(label: "com.chasemapper.api.state", attributes: .concurrent)

    // MARK: - Initialization

    init(
        baseURL: URL = ServerConfig.defaultBaseURL(),
        apiKey: String? = UserDefaults.standard.string(forKey: "apiKey").flatMap { $0.isEmpty ? nil : $0 },
        retryPolicy: RetryPolicy = .default
    ) {
        self.baseURL = baseURL
        self.apiKey = apiKey
        self.retryPolicy = retryPolicy

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        config.waitsForConnectivity = true
        config.requestCachePolicy = .reloadIgnoringLocalCacheData

        self.session = URLSession(configuration: config)
    }

    // MARK: - Public Methods

    func setAPIKey(_ key: String) {
        self.apiKey = key.isEmpty ? nil : key
    }

    /// Update the server base URL at runtime (e.g. after the user edits it in Settings).
    func updateBaseURL(_ url: URL) {
        self.baseURL = url
    }
    
    /// Fetch comprehensive mobile state snapshot
    /// - Returns: MobileStateDTO with current chase status
    /// - Timeout: 3 seconds
    func fetchMobileState() async throws -> MobileStateDTO {
        let endpoint = "/api/mobile_state"
        return try await performRequest(
            method: "GET",
            endpoint: endpoint,
            timeoutSeconds: 3.0,
            decodeTo: MobileStateDTO.self
        )
    }
    
    /// Fetch latest computed route
    /// - Returns: GeoJSON Feature representing the route
    /// - Timeout: 3 seconds
    func fetchLatestRoute() async throws -> GeoJSONFeature {
        let endpoint = "/api/latest_route"
        return try await performRequest(
            method: "GET",
            endpoint: endpoint,
            timeoutSeconds: 3.0,
            decodeTo: GeoJSONFeature.self
        )
    }
    
    /// Compute a new route between two coordinates
    /// - Parameters:
    ///   - start: Starting coordinate
    ///   - end: Ending coordinate
    /// - Returns: RouteResponseDTO with route geometry and metadata
    /// - Timeout: 8-10 seconds
    func computeRoute(
        from start: CLLocationCoordinate2D,
        to end: CLLocationCoordinate2D
    ) async throws -> RouteResponseDTO {
        let endpoint = "/api/route"
        let request = RouteRequestDTO(
            startLat: start.latitude,
            startLon: start.longitude,
            endLat: end.latitude,
            endLon: end.longitude
        )
        
        return try await performRequest(
            method: "POST",
            endpoint: endpoint,
            body: request,
            timeoutSeconds: 9.0,
            decodeTo: RouteResponseDTO.self
        )
    }
    
    // MARK: - Legacy Methods (for backward compatibility)
    
    func fetchPayloads() async throws -> [Payload] {
        let endpoint = "/api/payloads"
        let (data, _) = try await performRawRequest(
            method: "GET",
            endpoint: endpoint,
            timeoutSeconds: 10.0
        )
        let response = try decoder.decode(ServerResponse<[Payload]>.self, from: data)
        return response.data ?? []
    }
    
    func fetchSessions() async throws -> [ChaseSession] {
        let endpoint = "/api/sessions"
        let (data, _) = try await performRawRequest(
            method: "GET",
            endpoint: endpoint,
            timeoutSeconds: 10.0
        )
        let response = try decoder.decode(ServerResponse<[ChaseSession]>.self, from: data)
        return response.data ?? []
    }
    
    func createSession(name: String) async throws -> ChaseSession {
        let endpoint = "/api/sessions"
        let payload = ["name": name]
        let (data, _) = try await performRawRequest(
            method: "POST",
            endpoint: endpoint,
            body: payload,
            timeoutSeconds: 10.0
        )
        let response = try decoder.decode(ServerResponse<ChaseSession>.self, from: data)
        guard let session = response.data else {
            throw APIError.unknown("Invalid response from server")
        }
        return session
    }
    
    func updateSessionStatus(sessionId: String, status: ChaseStatus) async throws -> ChaseSession {
        let endpoint = "/api/sessions/\(sessionId)"
        let payload = ["status": status.rawValue]
        let (data, _) = try await performRawRequest(
            method: "PATCH",
            endpoint: endpoint,
            body: payload,
            timeoutSeconds: 10.0
        )
        let response = try decoder.decode(ServerResponse<ChaseSession>.self, from: data)
        guard let session = response.data else {
            throw APIError.unknown("Invalid response from server")
        }
        return session
    }
    
    // MARK: - Private Methods
    
    private func performRequest<T: Decodable>(
        method: String,
        endpoint: String,
        body: Encodable? = nil,
        timeoutSeconds: TimeInterval,
        decodeTo: T.Type
    ) async throws -> T {
        let (data, _) = try await performRawRequest(
            method: method,
            endpoint: endpoint,
            body: body,
            timeoutSeconds: timeoutSeconds
        )
        
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingFailed(error.localizedDescription)
        }
    }
    
    private func performRawRequest(
        method: String,
        endpoint: String,
        body: Encodable? = nil,
        timeoutSeconds: TimeInterval
    ) async throws -> (Data, URLResponse) {
        // Check circuit breaker
        try checkCircuitBreaker(for: endpoint)
        
        // Attempt with retry logic
        var lastError: Error?
        
        for attempt in 1...retryPolicy.maxAttempts {
            do {
                let result = try await executeRequest(
                    method: method,
                    endpoint: endpoint,
                    body: body,
                    timeoutSeconds: timeoutSeconds
                )
                recordSuccess(for: endpoint)
                return result
            } catch {
                lastError = error
                
                let isRetryable = shouldRetry(error: error)
                if !isRetryable || attempt >= retryPolicy.maxAttempts {
                    recordFailure(for: endpoint)
                    throw error
                }
                
                let delay = retryPolicy.delayForAttempt(attempt)
                try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
        }
        
        if let error = lastError {
            recordFailure(for: endpoint)
            throw error
        }
        
        recordFailure(for: endpoint)
        throw APIError.unknown("Request failed after \(retryPolicy.maxAttempts) attempts")
    }
    
    private func executeRequest(
        method: String,
        endpoint: String,
        body: Encodable?,
        timeoutSeconds: TimeInterval
    ) async throws -> (Data, URLResponse) {
        guard let url = URL(string: endpoint, relativeTo: baseURL) else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = timeoutSeconds
        
        // Set headers
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        
        if let apiKey = apiKey {
            request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        }
        
        // Encode body if present
        if let body = body {
            do {
                request.httpBody = try JSONEncoder().encode(body)
            } catch {
                throw APIError.decodingFailed("Failed to encode request: \(error.localizedDescription)")
            }
        }
        
        do {
            let (data, response) = try await session.data(for: request)
            try validateResponse(response, data: data)
            return (data, response)
        } catch let error as URLError {
            if error.code == .timedOut {
                throw APIError.timeout
            }
            throw APIError.networkError(error.localizedDescription)
        } catch {
            throw error
        }
    }
    
    private func validateResponse(_ response: URLResponse, data: Data) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.unknown("Invalid response type")
        }
        
        let statusCode = httpResponse.statusCode
        
        guard (200...299).contains(statusCode) else {
            // Parse error response
            let errorMessage = parseErrorMessage(from: data)
            
            switch statusCode {
            case 401:
                throw APIError.unauthorized
            case 429:
                let retryAfter = parseRetryAfter(from: data, headers: httpResponse.allHeaderFields)
                throw APIError.rateLimited(retryAfterSeconds: retryAfter)
            case 400, 404:
                throw APIError.requestFailed(statusCode: statusCode, message: errorMessage)
            case 500, 502, 503:
                throw APIError.requestFailed(statusCode: statusCode, message: errorMessage)
            default:
                throw APIError.requestFailed(statusCode: statusCode, message: errorMessage)
            }
        }
    }
    
    private func parseErrorMessage(from data: Data) -> String {
        if let error = try? decoder.decode(ErrorDTO.self, from: data) {
            return error.error
        }
        return "Unknown error"
    }
    
    private func parseRetryAfter(from data: Data, headers: [AnyHashable: Any]) -> Int? {
        // Check Retry-After header first
        if let retryAfter = headers["Retry-After"] as? String {
            return Int(retryAfter)
        }
        
        // Check error response body
        if let error = try? decoder.decode(ErrorDTO.self, from: data) {
            return error.retryAfterS
        }
        
        return nil
    }
    
    private func shouldRetry(error: Error) -> Bool {
        if let apiError = error as? APIError {
            switch apiError {
            case .rateLimited:
                return false
            case .circuitBreakerOpen:
                return false
            case .unauthorized:
                return false
            case .requestFailed(let statusCode, _):
                return HTTPStatusCode(rawValue: statusCode)?.isRetryable ?? false
            default:
                return true
            }
        }
        return true
    }
    
    // MARK: - Circuit Breaker Management
    
    private func checkCircuitBreaker(for endpoint: String) throws {
        let state = stateQueue.sync {
            circuitBreakers[endpoint] ?? .closed
        }
        
        switch state {
        case .closed:
            break
        case .open(let resumeAt):
            if Date() >= resumeAt {
                stateQueue.async(flags: .barrier) {
                    self.circuitBreakers[endpoint] = .halfOpen
                }
            } else {
                throw APIError.circuitBreakerOpen(endpoint: endpoint, resumeAt: resumeAt)
            }
        case .halfOpen:
            break
        }
    }
    
    private func recordSuccess(for endpoint: String) {
        stateQueue.async(flags: .barrier) {
            self.circuitBreakers[endpoint] = .closed
            self.failureCounters[endpoint] = 0
        }
    }
    
    private func recordFailure(for endpoint: String) {
        stateQueue.async(flags: .barrier) {
            let count = (self.failureCounters[endpoint] ?? 0) + 1
            self.failureCounters[endpoint] = count
            
            if count >= 5 {
                let resumeAt = Date().addingTimeInterval(self.circuitBreakerPauseSeconds)
                self.circuitBreakers[endpoint] = .open(resumeAt: resumeAt)
            }
        }
    }
}
