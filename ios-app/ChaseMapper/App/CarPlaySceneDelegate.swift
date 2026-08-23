import SwiftUI
import Foundation

#if os(iOS)

import CarPlay
import MapKit

@available(iOS 16.0, *)
class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    var interfaceController: CPInterfaceController?
    var window: CPWindow?
    var mobileStateVM: MobileStateViewModel?
    var updateTimer: Timer?
    
    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController,
        to window: CPWindow
    ) {
        self.interfaceController = interfaceController
        self.window = window
        
        mobileStateVM = MobileStateViewModel()
        mobileStateVM?.start()
        
        // Create simple map template
        let mapTemplate = CPMapTemplate()
        mapTemplate.mapDelegate = self
        interfaceController.setRootTemplate(mapTemplate, animated: false)
        
        startUpdates()
    }
    
    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnect interfaceController: CPInterfaceController,
        from window: CPWindow
    ) {
        updateTimer?.invalidate()
        updateTimer = nil
        mobileStateVM?.stop()
        self.interfaceController = nil
        self.window = nil
    }
    
    private func startUpdates() {
        updateTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            // Update map with current state
        }
    }
}

// MARK: - CarPlay Delegate
@available(iOS 16.0, *)
extension CarPlaySceneDelegate: CPMapTemplateDelegate {
    // Delegate methods left empty for now
}

#else

// Non-iOS stub
class CarPlaySceneDelegate: NSObject {}

#endif
