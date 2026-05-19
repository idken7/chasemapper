import SwiftUI
import MapKit

struct RouteMapView: UIViewRepresentable {
    var route: [CLLocationCoordinate2D]
    var carCoordinate: CLLocationCoordinate2D?

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView(frame: .zero)
        map.showsCompass = true
        map.showsScale = false
        return map
    }

    func updateUIView(_ mapView: MKMapView, context: Context) {
        mapView.removeOverlays(mapView.overlays)
        mapView.removeAnnotations(mapView.annotations)

        if route.count > 1 {
            let line = MKPolyline(coordinates: route, count: route.count)
            mapView.addOverlay(line)
        }

        if let carCoordinate {
            let ann = MKPointAnnotation()
            ann.title = "Car"
            ann.coordinate = carCoordinate
            mapView.addAnnotation(ann)
        }

        // Keep view focused on car first, then route bounds.
        if let carCoordinate {
            let region = MKCoordinateRegion(
                center: carCoordinate,
                span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)
            )
            mapView.setRegion(region, animated: true)
        } else if route.count > 1 {
            mapView.showAnnotations(mapView.annotations, animated: true)
            mapView.showOverlays(mapView.overlays, animated: true)
        }

        mapView.delegate = context.coordinator
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            guard let polyline = overlay as? MKPolyline else {
                return MKOverlayRenderer(overlay: overlay)
            }
            let renderer = MKPolylineRenderer(polyline: polyline)
            renderer.strokeColor = .systemBlue
            renderer.lineWidth = 4
            return renderer
        }
    }
}

private extension MKMapView {
    func showOverlays(_ overlays: [MKOverlay], animated: Bool) {
        guard !overlays.isEmpty else { return }
        let rect = overlays.reduce(MKMapRect.null) { $0.union($1.boundingMapRect) }
        if !rect.isNull {
            setVisibleMapRect(rect, edgePadding: UIEdgeInsets(top: 50, left: 30, bottom: 50, right: 30), animated: animated)
        }
    }
}
