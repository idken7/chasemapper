import SwiftUI
import CoreLocation

struct ChasePrototypeScreen: View {
    @StateObject private var viewModel = ChasePrototypeViewModel()

    var body: some View {
        VStack(spacing: 0) {
            RouteMapView(
                route: viewModel.routeCoordinates,
                carCoordinate: viewModel.latestTelemetry.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            VStack(alignment: .leading, spacing: 6) {
                Text(viewModel.statusText)
                    .font(.headline)

                if let t = viewModel.latestTelemetry {
                    Text("Callsign: \(t.callsign)")
                    Text(String(format: "Car: %.5f, %.5f", t.lat, t.lon))
                    if let alt = t.alt {
                        Text(String(format: "Alt: %.0f m", alt))
                    }
                    if let speed = t.speed {
                        Text(String(format: "Speed: %.1f m/s", speed))
                    }
                } else {
                    Text("Waiting for telemetry...")
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemBackground))
        }
        .navigationTitle("Chase Prototype")
        .onAppear { viewModel.start() }
        .onDisappear { viewModel.stop() }
    }
}
