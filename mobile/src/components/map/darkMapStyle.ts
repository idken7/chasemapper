// Android (Google Maps) custom style approximating the mockup's near-black basemap.
// iOS uses MapKit's built-in dark mode instead (see ChaseMap.tsx's userInterfaceStyle).
export const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0a0d16' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0a0d16' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8fa3b8' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#1c2333' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#161c2c' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#6b7a90' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#1e2740' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d1420' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4a5b70' }] },
];
