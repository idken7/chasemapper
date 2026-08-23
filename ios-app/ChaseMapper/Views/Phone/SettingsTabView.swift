import SwiftUI

@available(iOS 16.0, *)
struct SettingsTabView: View {
    @ObservedObject var mobileStateVM: MobileStateViewModel
    @State private var serverURL = UserDefaults.standard.string(forKey: "serverURL") ?? "http://127.0.0.1:5001"
    @State private var apiKey = UserDefaults.standard.string(forKey: "apiKey") ?? ""
    
    var body: some View {
        NavigationView {
            List {
                Section("Server Configuration") {
                    HStack {
                        Text("Server URL")
                        TextField("http://...", text: $serverURL)
                            .textInputAutocapitalization(.never)
                            .disableAutocorrection(true)
                            .keyboardType(.URL)
                            .onSubmit {
                                mobileStateVM.applyServerSettings(urlString: serverURL, apiKey: apiKey)
                            }
                    }

                    HStack {
                        Text("API Key")
                        SecureField("Optional", text: $apiKey)
                            .disableAutocorrection(true)
                            .onSubmit {
                                mobileStateVM.applyServerSettings(urlString: serverURL, apiKey: apiKey)
                            }
                    }

                    Button("Save & Apply", action: {
                        mobileStateVM.applyServerSettings(urlString: serverURL, apiKey: apiKey)
                    })
                    .foregroundColor(.blue)
                }
                
                Section("Polling Configuration") {
                    HStack {
                        Text("Polling Interval")
                        Spacer()
                        Text("2 seconds")
                            .foregroundColor(.secondary)
                    }
                }
                
                Section("Actions") {
                    Button("Test Connection", action: {
                        mobileStateVM.start()
                    })
                    .foregroundColor(.blue)
                    
                    Button("Refresh Route", action: {
                        mobileStateVM.refreshRoute()
                    })
                    .foregroundColor(.blue)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

@available(iOS 16.0, *)
#Preview {
    SettingsTabView(mobileStateVM: MobileStateViewModel())
}

