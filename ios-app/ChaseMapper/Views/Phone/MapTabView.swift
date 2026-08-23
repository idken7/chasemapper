import SwiftUI
#if os(iOS)
import MapKit
#endif

@available(iOS 17.0, *)
struct MapTabView: View {
    @ObservedObject var mobileStateVM: MobileStateViewModel
    @ObservedObject var locationService: LocationTrackingService
    @State private var showRouteInfo = false
    @State private var userTrackingMode: MapUserTrackingMode = .follow
    
    var body: some View {
        #if os(iOS)
        ZStack(alignment: .topTrailing) {
            // Map with car location, target, and route
            Map(position: $mobileStateVM.mapPosition, interactionModes: .all) {
                // User location
                if let carLocation = mobileStateVM.carCoordinate {
                    Annotation("Car", coordinate: carLocation) {
                        VStack {
                            Image(systemName: "car.fill")
                                .font(.system(size: 20))
                                .foregroundColor(.white)
                                .padding(8)
                                .background(Color.blue)
                                .clipShape(Circle())
                        }
                    }
                }
                
                // Live payload position (APRS callsign)
                if let payloadLocation = mobileStateVM.payloadCoordinate {
                    Annotation(mobileStateVM.mobileState?.target?.callsign ?? "Payload", coordinate: payloadLocation) {
                        VStack {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.system(size: 20))
                                .foregroundColor(.white)
                                .padding(8)
                                .background(Color.orange)
                                .clipShape(Circle())

                            Text(mobileStateVM.mobileState?.target?.callsign ?? "Payload")
                                .font(.caption2)
                                .padding(4)
                                .background(Color.white)
                                .cornerRadius(4)
                        }
                    }
                }

                // Target landing site
                if let targetLocation = mobileStateVM.targetCoordinate {
                    Annotation("Target", coordinate: targetLocation) {
                        VStack {
                            Image(systemName: "location.fill")
                                .font(.system(size: 20))
                                .foregroundColor(.white)
                                .padding(8)
                                .background(Color.red)
                                .clipShape(Circle())

                            Text("Landing Site")
                                .font(.caption2)
                                .padding(4)
                                .background(Color.white)
                                .cornerRadius(4)
                        }
                    }
                }
                
                // Route polyline
                if mobileStateVM.routeCoordinates.count > 1 {
                    MapPolyline(coordinates: mobileStateVM.routeCoordinates)
                        .stroke(.blue, lineWidth: 3)
                }
            }
            .mapStyle(.standard)
            
            // Control buttons
            VStack(spacing: 12) {
                Button(action: { mobileStateVM.refreshRoute() }) {
                    Image(systemName: "arrow.clockwise")
                        .font(.title3)
                        .foregroundColor(.white)
                        .padding(12)
                        .background(Color.blue)
                        .clipShape(Circle())
                }
                
                Button(action: { showRouteInfo = true }) {
                    Image(systemName: "info.circle.fill")
                        .font(.title3)
                        .foregroundColor(.white)
                        .padding(12)
                        .background(Color.green)
                        .clipShape(Circle())
                }
            }
            .padding()
            
            // Bottom info panel
            VStack(alignment: .leading, spacing: 8) {
                Spacer()
                
                VStack(alignment: .leading, spacing: 6) {
                    Text(mobileStateVM.statusText)
                        .font(.headline)
                        .foregroundColor(.primary)
                    
                    if let callsign = mobileStateVM.mobileState?.target?.callsign {
                        Text("Tracking: \(callsign)")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    
                    if let carLoc = mobileStateVM.carCoordinate {
                        Text(String(format: "Car: %.4f°N, %.4f°E", carLoc.latitude, carLoc.longitude))
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    
                    if let target = mobileStateVM.mobileState?.target {
                        if let lat = target.landing.lat, let lon = target.landing.lon {
                            Text(String(format: "Target: %.4f°N, %.4f°E", lat, lon))
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    
                    HStack(spacing: 16) {
                        if let routeDistance = mobileStateVM.mobileState?.route.distanceM {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Distance")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                Text(String(format: "%.1f km", routeDistance / 1000))
                                    .font(.subheadline)
                                    .fontWeight(.semibold)
                            }
                        }
                        
                        if let routeTime = mobileStateVM.mobileState?.route.durationS {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("ETA")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                Text(formatDuration(routeTime))
                                    .font(.subheadline)
                                    .fontWeight(.semibold)
                            }
                        }
                        
                        Spacer()
                    }
                }
                .padding()
                .background(Color(.secondarySystemBackground))
                .cornerRadius(12)
            }
            .padding()
        }
        .sheet(isPresented: $showRouteInfo) {
            RouteInfoSheet(mobileStateVM: mobileStateVM)
        }
        .onAppear {
            mobileStateVM.start()
        }
        .onDisappear {
            mobileStateVM.stop()
        }
        #else
        VStack {
            Text("Map not available on this platform")
                .font(.headline)
        }
        #endif
    }
    
    private func formatDuration(_ seconds: Double) -> String {
        let total = Int(seconds)
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        return "\(minutes)m"
    }
}

struct RouteInfoSheet: View {
    @ObservedObject var mobileStateVM: MobileStateViewModel
    @Environment(\.dismiss) var dismiss
    
    var body: some View {
        NavigationStack {
            List {
                Section("Route Information") {
                    if let route = mobileStateVM.mobileState?.route {
                        if let distance = route.distanceM {
                            HStack {
                                Text("Distance")
                                Spacer()
                                Text(String(format: "%.2f km", distance / 1000))
                                    .fontWeight(.semibold)
                            }
                        }
                        
                        if let duration = route.durationS {
                            HStack {
                                Text("Duration")
                                Spacer()
                                Text(formatDuration(duration))
                                    .fontWeight(.semibold)
                            }
                        }
                        
                        if let provider = route.provider {
                            HStack {
                                Text("Route Provider")
                                Spacer()
                                Text(provider)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                    } else {
                        Text("No route calculated yet")
                            .foregroundColor(.secondary)
                    }
                }
                
                Section("Target Information") {
                    if let target = mobileStateVM.mobileState?.target {
                        HStack {
                            Text("Callsign")
                            Spacer()
                            Text(target.callsign)
                                .fontWeight(.semibold)
                        }
                        
                        if let lat = target.landing.lat, let lon = target.landing.lon {
                            HStack {
                                Text("Landing Coordinates")
                                Spacer()
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(String(format: "%.4f°", lat))
                                    Text(String(format: "%.4f°", lon))
                                }
                                .font(.caption)
                            }
                        }
                        
                        if let ttl = target.timeToLandingS {
                            HStack {
                                Text("Time to Landing")
                                Spacer()
                                Text(formatDuration(Double(ttl)))
                                    .fontWeight(.semibold)
                            }
                        }
                    } else {
                        Text("No target selected")
                            .foregroundColor(.secondary)
                    }
                }
                
                Section("Connection Status") {
                    HStack {
                        Text("Status")
                        Spacer()
                        Text(mobileStateVM.isConnected ? "Connected" : "Disconnected")
                            .fontWeight(.semibold)
                            .foregroundColor(mobileStateVM.isConnected ? .green : .red)
                    }
                    
                    if let error = mobileStateVM.errorMessage {
                        HStack {
                            Text("Error")
                            Spacer()
                            Text(error)
                                .font(.caption)
                                .foregroundColor(.red)
                        }
                    }
                }
            }
            .navigationTitle("Route Details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
    
    private func formatDuration(_ seconds: Double) -> String {
        let total = Int(seconds)
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        return "\(minutes)m"
    }
}

@available(iOS 17.0, *)
#Preview {
    MapTabView(
        mobileStateVM: MobileStateViewModel(),
        locationService: LocationTrackingService.shared
    )
}

@available(iOS 17.0, *)
#Preview {
    MapTabView(
        mobileStateVM: MobileStateViewModel(),
        locationService: LocationTrackingService()
    )
}
