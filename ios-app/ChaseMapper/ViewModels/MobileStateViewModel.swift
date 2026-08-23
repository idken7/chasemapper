import SwiftUI
import CoreLocation
import MapKit

// MARK: - Route State Enum

enum RouteStateDomain {
    case pending
    case loading
    case ready
    case error(String)

    var isPending: Bool {
        if case .pending = self { return true }
        return false
    }

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }

    var isReady: Bool {
        if case .ready = self { return true }
        return false
    }

    var errorMessage: String? {
        if case .error(let msg) = self { return msg }
        return nil
    }
}

// MARK: - Mobile State View Model

@MainActor
final class MobileStateViewModel: ObservableObject {
    // MARK: - Published State Properties

    @Published var mobileState: MobileStateDTO?
    @Published var route: RouteState?
    @Published var telemetry: TelemetrySnapshot?
    @Published var carCoordinate: CLLocationCoordinate2D?
    @Published var targetCoordinate: CLLocationCoordinate2D?
    @Published var payloadCoordinate: CLLocationCoordinate2D?
    @Published var isConnected: Bool = false
    @Published var errorMessage: String?
    @Published var selectedCallsign: String?
    @Published var routeState: RouteStateDomain = .pending
    @Published var lastUpdateTime: Date?
    @Published var mapRegion: MKCoordinateRegion = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194),
        span: MKCoordinateSpan(latitudeDelta: 0.5, longitudeDelta: 0.5)
    )
    @Published var mapPosition: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194),
            span: MKCoordinateSpan(latitudeDelta: 0.5, longitudeDelta: 0.5)
        )
    )
    @Published var routeCoordinates: [CLLocationCoordinate2D] = []
    @Published var statusText: String = "Initializing..."

    // MARK: - Private Properties

    private let apiService = APIService.shared
    private let socketService = SocketIOService.shared
    private let locationTrackingService = LocationTrackingService.shared
    private let routeCalculationService: RouteCalculationService
    private let telemetryDetector = TelemetryChangeDetector()
    private var pollingTask: Task<Void, Never>?
    private var scenePhaseObserver: NSObjectProtocol?
    private var lastTargetCoordinate: CLLocationCoordinate2D?
    private var locationUpdateTask: Task<Void, Never>?

    // MARK: - Initialization

    init(routeCalculationService: RouteCalculationService = RouteCalculationService()) {
        self.routeCalculationService = routeCalculationService
        setupScenePhaseObserver()
        setupSocketIOHandlers()
    }

    deinit {
        // Cancel tasks directly (safe in deinit, no async calls needed)
        pollingTask?.cancel()
        pollingTask = nil
        locationUpdateTask?.cancel()
        locationUpdateTask = nil

        // `disconnect()` is main-actor isolated, but `deinit` runs nonisolated,
        // so it must be hopped onto the actor rather than called directly here.
        let socketService = self.socketService
        Task { @MainActor in
            socketService.disconnect()
        }

        if let observer = scenePhaseObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    // MARK: - Public Methods

    /// Start the ViewModel's polling and monitoring
    func start() {
        socketService.connect()
        locationTrackingService.start()
        startLocationUpdates()
        startPolling()
    }

    /// Stop the ViewModel's polling and monitoring
    func stop() {
        stopPolling()
        stopLocationUpdates()
        locationTrackingService.stop()
        socketService.disconnect()
    }

    /// Apply a server URL / API key entered in Settings and immediately re-poll.
    func applyServerSettings(urlString: String, apiKey: String) {
        guard let url = URL(string: urlString) else {
            errorMessage = "Invalid server URL"
            return
        }
        UserDefaults.standard.set(urlString, forKey: "serverURL")
        UserDefaults.standard.set(apiKey, forKey: "apiKey")

        apiService.updateBaseURL(url)
        apiService.setAPIKey(apiKey)
        socketService.updateServerURL(url)

        Task { await pollMobileState() }
    }

    /// Manually trigger a route recomputation
    func refreshRoute() {
        guard let carCoord = carCoordinate, let targetCoord = targetCoordinate else {
            errorMessage = "Car or target position not available"
            return
        }

        computeRoute(from: carCoord, to: targetCoord)
    }

    /// Manually retry polling (useful after errors)
    func retryFetch() {
        errorMessage = nil
        Task {
            await pollMobileState()
        }
    }

    // MARK: - Private Methods - Scene Phase Handling

    private func setupScenePhaseObserver() {
        scenePhaseObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.stopPolling()
        }

        NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.startPolling()
        }
    }


    // MARK: - Private Methods - Polling

    private func startPolling() {
        guard pollingTask == nil else { return }

        pollingTask = Task {
            while !Task.isCancelled {
                await pollMobileState()
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    private func stopPolling() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    private func pollMobileState() async {
        do {
            let state = try await apiService.fetchMobileState()
            updateMobileState(state)
            errorMessage = nil
            isConnected = true
            lastUpdateTime = Date()
        } catch {
            isConnected = false
            errorMessage = formatError(error)
        }
    }

    // MARK: - Private Methods - State Updates

    private func updateMobileState(_ state: MobileStateDTO) {
        mobileState = state

        updateCarCoordinate(from: state)
        updateTargetCoordinate(from: state)
        updateRoute(from: state)
        updateSelectedCallsign(from: state)

        checkAndRecomputeRoute()
    }

    private func updateCarCoordinate(from state: MobileStateDTO) {
        // The phone's own GPS (see `updateCarCoordinateFromLocation`) is the primary source,
        // since this app runs in the chase vehicle. Only fall back to the server-reported
        // primary car track (e.g. a dedicated hardware GPS) if we have no local fix yet.
        guard carCoordinate == nil else { return }
        if let car = state.car, let lat = car.lat, let lon = car.lon {
            let coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lon)
            carCoordinate = coordinate
            mapRegion.center = coordinate
            mapPosition = .region(mapRegion)
        }
    }

    /// Update the car marker from the phone's own CoreLocation fix.
    private func updateCarCoordinateFromLocation(_ coordinate: CLLocationCoordinate2D) {
        let isFirstFix = carCoordinate == nil
        carCoordinate = coordinate
        if isFirstFix {
            mapRegion.center = coordinate
            mapPosition = .region(mapRegion)
        }
    }

    private func updateTargetCoordinate(from state: MobileStateDTO) {
        if let target = state.target, let lat = target.landing.lat, let lon = target.landing.lon {
            targetCoordinate = CLLocationCoordinate2D(latitude: lat, longitude: lon)
        } else {
            targetCoordinate = nil
        }

        if let telemetry = state.target?.telemetry, let lat = telemetry.lat, let lon = telemetry.lon {
            payloadCoordinate = CLLocationCoordinate2D(latitude: lat, longitude: lon)
        } else {
            payloadCoordinate = nil
        }
    }

    private func updateRoute(from state: MobileStateDTO) {
        // Convert GeoJSONMinimalDTO to GeoJSONFeature
        let convertedGeoJSON = state.route.geojson.flatMap { minimal in
            GeoJSONFeature(
                type: minimal.type ?? "Feature",
                geometry: GeoJSONGeometry(
                    type: minimal.geometry?.type ?? "LineString",
                    coordinates: minimal.geometry?.coordinates ?? []
                ),
                properties: nil
            )
        }
        
        route = RouteState(
            geojson: convertedGeoJSON,
            distanceM: state.route.distanceM,
            durationS: state.route.durationS,
            provider: state.route.provider,
            providerBase: state.route.providerBase,
            updatedAt: state.route.updatedAt
        )

        // Extract coordinates from GeoJSON for map display
        if let geojson = state.route.geojson,
           let geometry = geojson.geometry,
           let coordinates = geometry.coordinates {
            routeCoordinates = coordinates.map { CLLocationCoordinate2D(latitude: $0[1], longitude: $0[0]) }
        } else {
            routeCoordinates = []
        }
        
        // Update status text
        updateStatusText()

        if state.route.geojson != nil {
            routeState = .ready
        }
    }
    
    private func updateStatusText() {
        if isConnected {
            if let route = route, let distance = route.distanceM, let duration = route.durationS {
                statusText = String(format: "Route: %.1f km, ETA: %.0f min", distance / 1000, duration / 60)
            } else if let target = mobileState?.target {
                statusText = "Ready • Tracking: \(target.callsign)"
            } else {
                statusText = "Connected • Waiting for target"
            }
        } else {
            statusText = "Disconnected..."
        }
    }

    private func updateSelectedCallsign(from state: MobileStateDTO) {
        if let target = state.target {
            selectedCallsign = target.callsign
        }
    }

    // MARK: - Private Methods - Route Management

    private func checkAndRecomputeRoute() {
        guard let targetCoord = targetCoordinate else { return }

        let shouldRecompute = routeCalculationService.shouldRecomputeRoute(
            previousTarget: lastTargetCoordinate,
            newTarget: targetCoord,
            carPosition: carCoordinate
        )
        
        if shouldRecompute {
            guard let carCoord = carCoordinate else { return }
            computeRoute(from: carCoord, to: targetCoord)
        }
    }

    private func computeRoute(from start: CLLocationCoordinate2D, to end: CLLocationCoordinate2D) {
        routeState = .loading

        Task {
            do {
                let routeState = try await routeCalculationService.computeRoute(from: start, to: end)

                self.route = routeState
                self.lastTargetCoordinate = end
                self.routeState = .ready
                self.errorMessage = nil
            } catch {
                self.routeState = .error(formatError(error))
                self.errorMessage = "Route computation failed: \(formatError(error))"
            }
        }
    }

    // MARK: - Private Methods - Location Updates

    private func startLocationUpdates() {
        guard locationUpdateTask == nil else { return }

        locationUpdateTask = Task {
            for await location in locationTrackingService.$currentLocation.values {
                guard let location = location else { continue }
                updateCarCoordinateFromLocation(location)
                checkAndRecomputeRoute()
            }
        }
    }

    private func stopLocationUpdates() {
        locationUpdateTask?.cancel()
        locationUpdateTask = nil
    }

    // MARK: - Private Methods - Socket.IO Integration

    private func setupSocketIOHandlers() {
        Task {
            for await event in socketService.$lastTelemetryEvent.values {
                guard let event = event else { continue }
                handleTelemetryEvent(event)
            }
        }
    }

    private func handleTelemetryEvent(_ event: TelemetryEvent) {
        let snapshot = event.snapshot

        if let previous = telemetry {
            if telemetryDetector.isSignificantChange(from: previous, to: snapshot) {
                telemetry = snapshot
            }
        } else {
            telemetry = snapshot
        }
    }

    // MARK: - Private Methods - Error Handling

    private func formatError(_ error: Error) -> String {
        if let apiError = error as? APIError {
            switch apiError {
            case .timeout:
                return "Request timeout. Check your connection."
            case .networkError(let msg):
                return "Network error: \(msg)"
            case .rateLimited(let retryAfterSeconds):
                return "Rate limited. Try again in \(retryAfterSeconds ?? 30)s"
            case .unauthorized:
                return "Unauthorized. Check your API key."
            case .requestFailed(let statusCode, let message):
                return "Server error (\(statusCode)): \(message)"
            case .circuitBreakerOpen:
                return "Service temporarily unavailable"
            case .decodingFailed(let msg):
                return "Data parsing error: \(msg)"
            case .invalidURL:
                return "Invalid server URL"
            case .unknown(let msg):
                return "Unknown error: \(msg)"
            }
        }

        return error.localizedDescription
    }
}
