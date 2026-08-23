import SwiftUI

@available(iOS 16.0, *)
struct PhoneContentView: View {
    @StateObject private var mobileStateVM = MobileStateViewModel()
    @StateObject private var locationService = LocationTrackingService.shared
    
    var body: some View {
        TabView {
            MapTabView(mobileStateVM: mobileStateVM, locationService: locationService)
                .tabItem {
                    Label("Map", systemImage: "map.fill")
                }
            
            StatusTabView(mobileStateVM: mobileStateVM)
                .tabItem {
                    Label("Status", systemImage: "info.circle.fill")
                }
            
            SettingsTabView(mobileStateVM: mobileStateVM)
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
        }
        .onAppear {
            mobileStateVM.start()
            locationService.start()
        }
        .onDisappear {
            mobileStateVM.stop()
        }
    }
}

@available(iOS 16.0, *)
struct StatusTabView: View {
    @ObservedObject var mobileStateVM: MobileStateViewModel
    
    var body: some View {
        NavigationStack {
            List {
                Section("Connection Status") {
                    HStack {
                        Text("Status")
                        Spacer()
                        Text(mobileStateVM.isConnected ? "Connected" : "Disconnected")
                            .fontWeight(.semibold)
                            .foregroundColor(mobileStateVM.isConnected ? .green : .red)
                    }
                    
                    if let lastUpdate = mobileStateVM.mobileState?.serverTime {
                        HStack {
                            Text("Last Update")
                            Spacer()
                            Text(lastUpdate)
                                .font(.caption)
                        }
                    }
                }
                
                Section("Target") {
                    if let target = mobileStateVM.mobileState?.target {
                        HStack {
                            Text("Callsign")
                            Spacer()
                            Text(target.callsign)
                                .fontWeight(.semibold)
                        }
                        
                        if let ttl = target.timeToLandingS {
                            HStack {
                                Text("Time to Landing")
                                Spacer()
                                Text("\(ttl)s")
                                    .fontWeight(.semibold)
                            }
                        }
                    } else {
                        Text("No target selected")
                            .foregroundColor(.secondary)
                    }
                }
                
                Section("Route") {
                    if let route = mobileStateVM.mobileState?.route {
                        if let distance = route.distanceM {
                            HStack {
                                Text("Distance")
                                Spacer()
                                Text(String(format: "%.2f km", distance / 1000))
                            }
                        }
                        
                        if let duration = route.durationS {
                            HStack {
                                Text("Duration")
                                Spacer()
                                Text(String(format: "%.0f min", duration / 60))
                            }
                        }
                    } else {
                        Text("No route available")
                            .foregroundColor(.secondary)
                    }
                }
                
                if let error = mobileStateVM.errorMessage {
                    Section("Errors") {
                        Text(error)
                            .foregroundColor(.red)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle("Chase Status")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

@available(iOS 16.0, *)
#Preview {
    PhoneContentView()
}
