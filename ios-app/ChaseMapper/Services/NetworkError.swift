import Foundation

// MARK: - API Error Types

enum APIError: LocalizedError, Equatable {
    case invalidURL
    case requestFailed(statusCode: Int, message: String)
    case decodingFailed(String)
    case rateLimited(retryAfterSeconds: Int?)
    case circuitBreakerOpen(endpoint: String, resumeAt: Date)
    case networkError(String)
    case unauthorized
    case timeout
    case unknown(String)
    
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .requestFailed(let code, let message):
            return "Request failed (HTTP \(code)): \(message)"
        case .decodingFailed(let reason):
            return "Failed to decode response: \(reason)"
        case .rateLimited(let retryAfter):
            if let seconds = retryAfter {
                return "Rate limited. Retry after \(seconds) seconds"
            }
            return "Rate limited"
        case .circuitBreakerOpen(let endpoint, _):
            return "Circuit breaker open for \(endpoint). Paused temporarily."
        case .networkError(let reason):
            return "Network error: \(reason)"
        case .unauthorized:
            return "Unauthorized. Check API key."
        case .timeout:
            return "Request timeout"
        case .unknown(let reason):
            return "Unknown error: \(reason)"
        }
    }
    
    var recoverySuggestion: String? {
        switch self {
        case .rateLimited(let retryAfter):
            if let seconds = retryAfter {
                return "Please wait \(seconds) seconds before retrying"
            }
            return "Please wait before retrying"
        case .circuitBreakerOpen(_, let resumeAt):
            let formatter = DateFormatter()
            formatter.timeStyle = .medium
            return "Service will resume at \(formatter.string(from: resumeAt))"
        case .unauthorized:
            return "Please check your API key configuration"
        case .timeout:
            return "The request took too long. Check your network connection."
        default:
            return nil
        }
    }
    
    static func == (lhs: APIError, rhs: APIError) -> Bool {
        switch (lhs, rhs) {
        case (.invalidURL, .invalidURL):
            return true
        case (.requestFailed(let lCode, let lMsg), .requestFailed(let rCode, let rMsg)):
            return lCode == rCode && lMsg == rMsg
        case (.decodingFailed(let lReason), .decodingFailed(let rReason)):
            return lReason == rReason
        case (.rateLimited(let lRetry), .rateLimited(let rRetry)):
            return lRetry == rRetry
        case (.circuitBreakerOpen(let lEndpoint, _), .circuitBreakerOpen(let rEndpoint, _)):
            return lEndpoint == rEndpoint
        case (.networkError(let lReason), .networkError(let rReason)):
            return lReason == rReason
        case (.unauthorized, .unauthorized):
            return true
        case (.timeout, .timeout):
            return true
        case (.unknown(let lReason), .unknown(let rReason)):
            return lReason == rReason
        default:
            return false
        }
    }
}

// MARK: - Socket.IO Error Types

enum SocketIOError: LocalizedError, Equatable {
    case connectionFailed(String)
    case disconnected(String)
    case eventHandlingFailed(String)
    case messageParsingFailed(String)
    case unknown(String)
    
    var errorDescription: String? {
        switch self {
        case .connectionFailed(let reason):
            return "Socket.IO connection failed: \(reason)"
        case .disconnected(let reason):
            return "Socket.IO disconnected: \(reason)"
        case .eventHandlingFailed(let reason):
            return "Failed to handle Socket.IO event: \(reason)"
        case .messageParsingFailed(let reason):
            return "Failed to parse Socket.IO message: \(reason)"
        case .unknown(let reason):
            return "Unknown Socket.IO error: \(reason)"
        }
    }
}

// MARK: - Retry Policy

struct RetryPolicy {
    let maxAttempts: Int
    let initialDelaySeconds: Double
    let maxDelaySeconds: Double
    let backoffMultiplier: Double
    let jitterFraction: Double
    
    static let `default` = RetryPolicy(
        maxAttempts: 3,
        initialDelaySeconds: 1.0,
        maxDelaySeconds: 15.0,
        backoffMultiplier: 2.0,
        jitterFraction: 0.1
    )
    
    static let aggressive = RetryPolicy(
        maxAttempts: 5,
        initialDelaySeconds: 0.5,
        maxDelaySeconds: 15.0,
        backoffMultiplier: 2.0,
        jitterFraction: 0.2
    )
    
    func delayForAttempt(_ attempt: Int) -> TimeInterval {
        guard attempt > 0 else { return 0 }
        
        let exponentialDelay = initialDelaySeconds * pow(backoffMultiplier, Double(attempt - 1))
        let cappedDelay = min(exponentialDelay, maxDelaySeconds)
        
        let jitterAmount = cappedDelay * jitterFraction
        let jitter = Double.random(in: -jitterAmount...jitterAmount)
        
        return max(0, cappedDelay + jitter)
    }
}

// MARK: - Circuit Breaker State

enum CircuitBreakerState: Equatable {
    case closed
    case open(resumeAt: Date)
    case halfOpen
    
    var isClosed: Bool {
        if case .closed = self { return true }
        return false
    }
    
    var isOpen: Bool {
        if case .open = self { return true }
        return false
    }
}

// MARK: - HTTP Status Codes

enum HTTPStatusCode: Int {
    case ok = 200
    case badRequest = 400
    case unauthorized = 401
    case notFound = 404
    case tooManyRequests = 429
    case internalServerError = 500
    case badGateway = 502
    case serviceUnavailable = 503
    
    var isRetryable: Bool {
        switch self {
        case .internalServerError, .badGateway, .serviceUnavailable:
            return true
        default:
            return false
        }
    }
    
    var isClientError: Bool {
        (400...499).contains(self.rawValue)
    }
    
    var isServerError: Bool {
        (500...599).contains(self.rawValue)
    }
}
