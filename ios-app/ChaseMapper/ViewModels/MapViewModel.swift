import SwiftUI
#if os(iOS)
import MapKit
#endif

@MainActor
class MapViewModel: NSObject, ObservableObject {
    @Published var region: MKCoordinateRegion = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194),
        span: MKCoordinateSpan(latitudeDelta: 0.5, longitudeDelta: 0.5)
    )
    @Published var payloads: [Payload] = []
    @Published var selectedPayload: Payload?
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    private let locationService = LocationService.shared
    private let apiService = APIService.shared
    
    override init() {
        super.init()
        setupLocationUpdates()
    }
    
    private func setupLocationUpdates() {
        locationService.startUpdatingLocation()
    }
    
    func fetchPayloads() {
        isLoading = true
        Task {
            do {
                let payloads = try await apiService.fetchPayloads()
                self.payloads = payloads
                errorMessage = nil
            } catch {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }
    
    func centerMapOnUserLocation() {
        #if os(iOS)
        if let userLocation = locationService.currentLocation {
            region = MKCoordinateRegion(
                center: userLocation.coordinate,
                span: MKCoordinateSpan(
                    latitudeDelta: 0.5,
                    longitudeDelta: 0.5
                )
            )
        }
        #endif
    }
}
