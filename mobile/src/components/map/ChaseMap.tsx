import { forwardRef } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Callout, Marker, Polyline, type LatLng, type Region } from 'react-native-maps';
import { darkMapStyle } from './darkMapStyle';
import { BalloonMarker } from './markers/BalloonMarker';
import { CarMarker } from './markers/CarMarker';
import { ChaserMarker } from './markers/ChaserMarker';
import { LandingMarker } from './markers/LandingMarker';
import { BurstMarker } from './markers/BurstMarker';
import { colors, fonts, radii } from '../../theme/tokens';
import type { BalloonColour } from '../../store/telemetryStore';

export type MapMarkerKind = 'balloon' | 'ownCar' | 'chaser' | 'landing' | 'burst';

export interface MapMarkerDescriptor {
  id: string;
  coordinate: LatLng;
  kind: MapMarkerKind;
  headingDeg?: number | null;
  onPress?: () => void;
  // Balloon-only: a persistent label under the icon (so multiple tracked balloons/
  // chasers are distinguishable at a glance) and tap-to-reveal detail text.
  label?: string;
  calloutTitle?: string;
  calloutSubtitle?: string;
  // balloon/landing-only: which of the desktop's 3 rotating icon colours this
  // callsign was assigned (see telemetryStore's nextColour()).
  colour?: BalloonColour;
  // balloon-only: picks the ascending/descending/landed glyph, matching the
  // desktop Cesium map's balloon/parachute/payload billboard switch.
  altitudeM?: number;
  velV?: number;
}

export type MapPolylineKind = 'path' | 'predicted' | 'abort' | 'route';

export interface MapPolylineDescriptor {
  id: string;
  coordinates: LatLng[];
  kind: MapPolylineKind;
}

const POLYLINE_STYLE: Record<MapPolylineKind, { color: string; width: number; dash?: number[] }> = {
  path: { color: colors.trackBlue, width: 2.5 },
  predicted: { color: colors.accent, width: 2, dash: [6, 4] },
  abort: { color: colors.danger, width: 2, dash: [4, 4] },
  // Distinct from the (dashed, yellow) predicted flight path — this is the actual
  // road-following drive route, and sharing a color with the through-the-air
  // prediction made the two easy to mistake for each other on the same map.
  route: { color: colors.chaserOther, width: 4 },
};

function renderMarkerContent(marker: MapMarkerDescriptor) {
  switch (marker.kind) {
    case 'balloon':
      return <BalloonMarker label={marker.label} colour={marker.colour} altitudeM={marker.altitudeM} velV={marker.velV} />;
    case 'ownCar':
      return <CarMarker headingDeg={marker.headingDeg} />;
    case 'chaser':
      return <ChaserMarker headingDeg={marker.headingDeg} />;
    case 'landing':
      return <LandingMarker colour={marker.colour} />;
    case 'burst':
      return <BurstMarker />;
    default:
      return null;
  }
}

export interface ChaseMapProps {
  markers: MapMarkerDescriptor[];
  polylines?: MapPolylineDescriptor[];
  initialRegion: Region;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  // The device's own native "blue dot" position — distinct from the ownCar marker,
  // which only appears once GPS telemetry has round-tripped through the server.
  // Defaults on so the phone's location is visible as soon as permission is granted.
  showUserLocation?: boolean;
}

export const ChaseMap = forwardRef<MapView, ChaseMapProps>(function ChaseMap(
  { markers, polylines = [], initialRegion, style, onPress, showUserLocation = true },
  ref
) {
  return (
    <MapView
      ref={ref}
      style={[StyleSheet.absoluteFill, style]}
      initialRegion={initialRegion}
      customMapStyle={darkMapStyle}
      userInterfaceStyle="dark"
      showsCompass={false}
      showsUserLocation={showUserLocation}
      showsMyLocationButton={false}
      onPress={onPress}
    >
      {polylines.map((line) => {
        const lineStyle = POLYLINE_STYLE[line.kind];
        return (
          <Polyline
            key={line.id}
            coordinates={line.coordinates}
            strokeColor={lineStyle.color}
            strokeWidth={lineStyle.width}
            lineDashPattern={lineStyle.dash}
          />
        );
      })}
      {markers.map((marker) => (
        <Marker key={marker.id} coordinate={marker.coordinate} onPress={marker.onPress} tracksViewChanges={false}>
          {renderMarkerContent(marker)}
          {marker.calloutTitle && (
            <Callout tooltip>
              <View style={calloutStyles.box}>
                <Text style={calloutStyles.title}>{marker.calloutTitle}</Text>
                {marker.calloutSubtitle && <Text style={calloutStyles.subtitle}>{marker.calloutSubtitle}</Text>}
              </View>
            </Callout>
          )}
        </Marker>
      ))}
    </MapView>
  );
});

const calloutStyles = StyleSheet.create({
  box: {
    minWidth: 120,
    backgroundColor: 'rgba(10,13,22,0.95)',
    borderWidth: 1,
    borderColor: colors.borderAccent,
    borderRadius: radii.md,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  title: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 12.5,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.text,
    fontFamily: fonts.monoMedium,
    fontSize: 11,
    marginTop: 3,
  },
});
