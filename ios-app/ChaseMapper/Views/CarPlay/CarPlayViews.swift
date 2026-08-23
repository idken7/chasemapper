import SwiftUI
import MapKit

// MARK: - CarPlay Map View (iOS 15+)
@available(iOS 16.0, *)
struct CarPlayMapView: View {
    @ObservedObject var mobileStateVM: MobileStateViewModel
    @State private var region: MKCoordinateRegion = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194),
        span: MKCoordinateSpan(latitudeDelta: 0.1, longitudeDelta: 0.1)
    )
    
    var body: some View {
        ZStack {
            if let carCoord = mobileStateVM.carCoordinate {
                MapViewRepresentable(
                    region: $region,
                    annotations: getAnnotations()
                )
                .edgesIgnoringSafeArea(.all)
                
                VStack(alignment: .leading) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Navigation")
                                .font(.headline)
                                .foregroundColor(.white)
                            
                            if let distance = mobileStateVM.route?.distanceM {
                                Text(String(format: "%.1f km", distance / 1000))
                                    .font(.subheadline)
                                    .foregroundColor(.gray)
                            }
                        }
                        Spacer()
                    }
                    .padding()
                    .background(Color.black.opacity(0.6))
                    .cornerRadius(8)
                    .padding()
                    
                    Spacer()
                }
            } else {
                VStack {
                    Text("No Location Available")
                        .foregroundColor(.gray)
                }
            }
        }
    }
    
    private func getAnnotations() -> [(CLLocationCoordinate2D, String, UIColor)] {
        var annotations: [(CLLocationCoordinate2D, String, UIColor)] = []
        
        if let carCoord = mobileStateVM.carCoordinate {
            annotations.append((carCoord, "Car", .blue))
        }
        
        if let targetCoord = mobileStateVM.targetCoordinate {
            annotations.append((targetCoord, "Target", .red))
        }
        
        return annotations
    }
}

// MARK: - Map View Representable
struct MapViewRepresentable: UIViewRepresentable {
    @Binding var region: MKCoordinateRegion
    let annotations: [(CLLocationCoordinate2D, String, UIColor)]
    
    func makeUIView(context: Context) -> MKMapView {
        let mapView = MKMapView()
        mapView.delegate = context.coordinator
        mapView.setRegion(region, animated: true)
        
        // Add annotations
        for (coordinate, title, _) in annotations {
            let annotation = MKPointAnnotation()
            annotation.coordinate = coordinate
            annotation.title = title
            mapView.addAnnotation(annotation)
        }
        
        return mapView
    }
    
    func updateUIView(_ uiView: MKMapView, context: Context) {
        uiView.setRegion(region, animated: true)
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }
    
    class Coordinator: NSObject, MKMapViewDelegate {
        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            let identifier = "Annotation"
            let annotationView = MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: identifier)
            
            if annotation.title == "Car" {
                annotationView.markerTintColor = .blue
            } else if annotation.title == "Target" {
                annotationView.markerTintColor = .red
            }
            
            return annotationView
        }
    }
}

// MARK: - CarPlay Preview
@available(iOS 16.0, *)
#Preview {
    CarPlayMapView(mobileStateVM: MobileStateViewModel())
}
