//
//   Project Horus - Browser-Based Chase Mapper - Cesium 3D Map Bridge
//
//   Copyright (C) 2019  Mark Jessop <vk5qi@rfhead.net>
//   Released under GNU GPL v3 or later
//

(function() {
    var cesiumState = {
        viewer: null,
        active: false,
        is2DMode: false,  // NEW: Track 2D vs 3D mode
        measureModeActive: false,
        measurePoints: [],
        measureEntities: [],
        measurePolyline: null,
        measureHoverPoint: null,
        mapMode: 'standard',
        mapModeApplySeq: 0,
        buildingsTileset: null,
        buildingsDataSource: null,
        camera: {
            heading: 0,
            pitch: -35,
            range: 7500,
            focus: null
        },
        camera2D: {  // NEW: 2D mode camera state (overhead view)
            heading: 0,
            pitch: -90,
            range: 7500
        },
        camera3D: {  // NEW: 3D mode camera state (angled view)
            heading: 0,
            pitch: -35,
            range: 7500
        },
        balloonEntities: {},
        predictionEntities: {},
        chaseCarEntity: null,
        homeEntity: null,
        rangeRingEntities: [],
        bearingLineEntities: {},
        resizeTimer: null,
        resizeListenerBound: false,
    };

    var CESIUM_CAMERA_STORAGE_KEY = 'chasemapper_cesium_camera';
    var CESIUM_MAP_MODE_STORAGE_KEY = 'chasemapper_cesium_map_mode';
    var CESIUM_2D_MODE_STORAGE_KEY = 'chasemapper_cesium_2d_mode';
    var DEFAULT_CAMERA_STATE = {
        heading: 0,
        pitch: -35,
        range: 7500
    };

    function getCesiumMapModes() {
        var modes = [
            {id: 'standard', label: 'Standard (OSM)'},
            {id: 'satellite', label: 'Satellite'},
            {id: 'terrain', label: 'Satellite + Terrain'},
            {id: 'buildings', label: 'Satellite + Terrain + 3D Buildings'},
            {id: 'aviation', label: 'Aviation (World Navigation)'}
        ];

        try {
            if (typeof chase_config !== 'undefined' && chase_config && chase_config.thunderforest_api_key && chase_config.thunderforest_api_key !== 'none') {
                modes.push({id: 'outdoors', label: 'Outdoors (Terrain)'});
            }
            if (typeof chase_config !== 'undefined' && chase_config && chase_config.stadia_api_key && chase_config.stadia_api_key !== 'none') {
                modes.push({id: 'dark', label: 'Alidade Smooth Dark'});
            }
            if (typeof chase_config !== 'undefined' && chase_config && chase_config.openaip_api_key && chase_config.openaip_api_key !== 'none') {
                modes.push({id: 'openaip', label: 'Aviation (openAIP)'});
            }
        } catch (e) {
            // ignore dynamic mode build failures
        }

        try {
            var offline = (typeof chase_config !== 'undefined' && chase_config && Array.isArray(chase_config.offline_tile_layers)) ? chase_config.offline_tile_layers : [];
            offline.forEach(function(layerName) {
                var key = (layerName || '').toString().trim();
                if (!key) {
                    return;
                }
                modes.push({
                    id: 'offline:' + key,
                    label: 'Offline 3D Imagery - ' + key
                });
            });
        } catch (e) {
            // ignore dynamic mode build failures
        }

        return modes;
    }

    function getStoredMapMode() {
        try {
            var stored = localStorage.getItem(CESIUM_MAP_MODE_STORAGE_KEY);
            if (stored && stored.length > 0) {
                return stored;
            }
        } catch (e) {
            // ignore storage failures
        }

        if (typeof chase_config !== 'undefined' && chase_config && chase_config.cesium_map_mode) {
            return chase_config.cesium_map_mode;
        }

        return 'standard';
    }

    function persistMapMode(modeId) {
        try {
            localStorage.setItem(CESIUM_MAP_MODE_STORAGE_KEY, modeId);
        } catch (e) {
            // ignore storage failures
        }
    }

    function normalizeMapMode(modeId) {
        var requested = (modeId || '').toString();
        var availableModes = getCesiumMapModes();
        for (var i = 0; i < availableModes.length; i++) {
            if (availableModes[i].id === requested) {
                return requested;
            }
        }
        return 'standard';
    }

    function modeUsesTerrain(modeId) {
        return modeId === 'terrain' || modeId === 'buildings';
    }

    function modeUsesBuildings(modeId) {
        return modeId === 'buildings';
    }

    function createImageryProviderForMode(modeId) {
        if (modeId.indexOf('offline:') === 0) {
            var layerName = modeId.substring('offline:'.length);
            return new Cesium.UrlTemplateImageryProvider({
                url: location.protocol + '//' + document.domain + ':' + location.port + '/tiles/' + layerName + '/{z}/{x}/{y}.png'
            });
        }

        if (modeId === 'satellite' || modeId === 'terrain' || modeId === 'buildings') {
            return new Cesium.UrlTemplateImageryProvider({
                url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
            });
        }

        if (modeId === 'aviation') {
            return new Cesium.UrlTemplateImageryProvider({
                url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Specialty/World_Navigation_Charts/MapServer/tile/{z}/{y}/{x}',
                maximumLevel: 18
            });
        }

        if (modeId === 'outdoors' && typeof chase_config !== 'undefined' && chase_config && chase_config.thunderforest_api_key && chase_config.thunderforest_api_key !== 'none') {
            return new Cesium.UrlTemplateImageryProvider({
                url: 'https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=' + chase_config.thunderforest_api_key
            });
        }

        if (modeId === 'dark' && typeof chase_config !== 'undefined' && chase_config && chase_config.stadia_api_key && chase_config.stadia_api_key !== 'none') {
            return new Cesium.UrlTemplateImageryProvider({
                url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png?apikey=' + chase_config.stadia_api_key
            });
        }

        if (modeId === 'openaip' && typeof chase_config !== 'undefined' && chase_config && chase_config.openaip_api_key && chase_config.openaip_api_key !== 'none') {
            return new Cesium.UrlTemplateImageryProvider({
                url: 'https://api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey=' + encodeURIComponent(chase_config.openaip_api_key),
                maximumLevel: 14
            });
        }

        return new Cesium.OpenStreetMapImageryProvider({
            url: 'https://tile.openstreetmap.org/'
        });
    }

    function clampNumber(value, minValue, maxValue, fallback) {
        var parsed = parseFloat(value);
        if (!isFinite(parsed)) {
            return fallback;
        }
        return Math.min(Math.max(parsed, minValue), maxValue);
    }

    function getStoredCameraState() {
        var stored = null;
        try {
            stored = localStorage.getItem(CESIUM_CAMERA_STORAGE_KEY);
        } catch (e) {
            stored = null;
        }

        if (!stored) {
            return {
                heading: DEFAULT_CAMERA_STATE.heading,
                pitch: DEFAULT_CAMERA_STATE.pitch,
                range: DEFAULT_CAMERA_STATE.range
            };
        }

        try {
            var parsed = JSON.parse(stored);
            return {
                heading: clampNumber(parsed.heading, -180, 180, DEFAULT_CAMERA_STATE.heading),
                pitch: clampNumber(parsed.pitch, -89, -5, DEFAULT_CAMERA_STATE.pitch),
                range: clampNumber(parsed.range, 1000, 50000, DEFAULT_CAMERA_STATE.range)
            };
        } catch (e) {
            return {
                heading: DEFAULT_CAMERA_STATE.heading,
                pitch: DEFAULT_CAMERA_STATE.pitch,
                range: DEFAULT_CAMERA_STATE.range
            };
        }
    }

    function persistCameraState() {
        try {
            localStorage.setItem(CESIUM_CAMERA_STORAGE_KEY, JSON.stringify({
                heading: cesiumState.camera.heading,
                pitch: cesiumState.camera.pitch,
                range: cesiumState.camera.range
            }));
        } catch (e) {
            // ignore storage failures
        }
    }

    function updateCameraSliderDisplay() {
        var panel = getCesiumCameraSliderPanel();
        var input = getCesiumCameraSliderInput();
        var value = getCesiumCameraSliderValue();

        if (input) {
            input.value = String(Math.round(cesiumState.camera.pitch));
        }
        if (value) {
            value.textContent = String(Math.round(cesiumState.camera.pitch)) + '\u00b0';
        }
        if (panel) {
            panel.classList.toggle('is-open', !!cesiumState.cameraSliderEntity);
        }
    }

    function hideCesiumCameraSlider() {
        cesiumState.cameraSliderEntity = null;
        var panel = getCesiumCameraSliderPanel();
        if (panel) {
            panel.classList.remove('is-open');
        }
    }

    function showCesiumCameraSlider(callsign) {
        cesiumState.cameraSliderEntity = (callsign || '').toString().toUpperCase() || null;
        var title = getCesiumCameraSliderTitle();
        if (title) {
            title.textContent = cesiumState.cameraSliderEntity ? ('Camera angle: ' + cesiumState.cameraSliderEntity) : 'Camera angle';
        }
        updateCameraSliderDisplay();
    }

    function setCesiumCameraPitch(pitch) {
        applyCameraState({
            heading: cesiumState.camera.heading,
            pitch: pitch,
            range: cesiumState.camera.range
        });

        if (cesiumState.active) {
            refocusCesiumCamera();
        }

        updateCameraSliderDisplay();
        return cesiumState.camera.pitch;
    }

    function zoomCesiumViewIn() {
        if (cesiumState.viewer) {
            try {
                var zoomAmount = Math.max(cesiumState.camera.range * 0.2, 500);
                if (typeof cesiumState.viewer.camera.zoomIn === 'function') {
                    cesiumState.viewer.camera.zoomIn(zoomAmount);
                } else {
                    cesiumState.viewer.camera.moveForward(zoomAmount);
                }
            } catch (e) {}
        }
        syncCameraStateFromViewer();
        persistCameraState();
    }

    function zoomCesiumViewOut() {
        if (cesiumState.viewer) {
            try {
                var zoomAmount = Math.max(cesiumState.camera.range * 0.2, 500);
                if (typeof cesiumState.viewer.camera.zoomOut === 'function') {
                    cesiumState.viewer.camera.zoomOut(zoomAmount);
                } else {
                    cesiumState.viewer.camera.moveBackward(zoomAmount);
                }
            } catch (e) {}
        }
        syncCameraStateFromViewer();
        persistCameraState();
    }

    function set2DMode() {
        cesiumState.is2DMode = true;
        cesiumState.camera.pitch = -90;
        if (cesiumState.viewer) {
            try {
                cesiumState.viewer.camera.flyTo({
                    destination: cesiumState.viewer.camera.position,
                    orientation: {
                        heading: Cesium.Math.toRadians(cesiumState.camera.heading),
                        pitch: Cesium.Math.toRadians(-90),
                        roll: 0
                    },
                    duration: 0.8
                });
            } catch (e) {}
        }
        persist2DMode();
        persistCameraState();
    }

    function set3DMode() {
        cesiumState.is2DMode = false;
        cesiumState.camera.pitch = -35;
        if (cesiumState.viewer) {
            try {
                cesiumState.viewer.camera.flyTo({
                    destination: cesiumState.viewer.camera.position,
                    orientation: {
                        heading: Cesium.Math.toRadians(cesiumState.camera.heading),
                        pitch: Cesium.Math.toRadians(-35),
                        roll: 0
                    },
                    duration: 0.8
                });
            } catch (e) {}
        }
        persist2DMode();
        persistCameraState();
    }

    function get2DMode() {
        return cesiumState.is2DMode;
    }

    function toggle2D3DMode() {
        if (cesiumState.is2DMode) {
            set3DMode();
        } else {
            set2DMode();
        }
    }

    function persist2DMode() {
        try {
            localStorage.setItem(CESIUM_2D_MODE_STORAGE_KEY, cesiumState.is2DMode ? '1' : '0');
        } catch (e) {
            // ignore storage failures
        }
    }

    function getStored2DMode() {
        try {
            var stored = localStorage.getItem(CESIUM_2D_MODE_STORAGE_KEY);
            return stored === '1' || stored === 'true';
        } catch (e) {
            return false;
        }
    }

    function getCesiumViewer() {
        return cesiumState.viewer;
    }

    function getCesiumMeasurePanel() {
        return document.getElementById('cesiumMeasurePanel');
    }

    function formatMeasureDistance(meters) {
        if (!isFinite(meters) || meters < 0) {
            return '0 m';
        }
        if (meters >= 1000) {
            return (meters / 1000).toFixed(meters >= 10000 ? 1 : 2) + ' km';
        }
        return Math.round(meters) + ' m';
    }

    function computeMeasureDistance(points) {
        if (!Array.isArray(points) || points.length < 2) {
            return 0;
        }

        var total = 0;
        for (var i = 0; i < points.length - 1; i++) {
            var start = Cesium.Cartographic.fromCartesian(points[i]);
            var end = Cesium.Cartographic.fromCartesian(points[i + 1]);
            if (!start || !end) {
                continue;
            }
            var geodesic = new Cesium.EllipsoidGeodesic(start, end);
            total += geodesic.surfaceDistance || 0;
        }
        return total;
    }

    function updateMeasurePanel() {
        var panel = getCesiumMeasurePanel();
        if (!panel) {
            return;
        }

        var distanceText = formatMeasureDistance(computeMeasureDistance(cesiumState.measurePoints));
        var pointCountText = String(cesiumState.measurePoints.length);
        var statusText = cesiumState.measureModeActive ? 'Click points on the map. Double-click to finish.' : 'Measurement saved.';

        var distanceEl = panel.querySelector('#cesiumMeasureDistance');
        var pointsEl = panel.querySelector('#cesiumMeasureCount');
        var statusEl = panel.querySelector('#cesiumMeasureStatus');
        var toggleBtn = panel.querySelector('#cesiumMeasureToggleBtn');

        if (distanceEl) {
            distanceEl.textContent = distanceText;
        }
        if (pointsEl) {
            pointsEl.textContent = pointCountText;
        }
        if (statusEl) {
            statusEl.textContent = statusText;
        }
        if (toggleBtn) {
            toggleBtn.textContent = cesiumState.measureModeActive ? 'Finish' : 'Measure again';
        }

        panel.classList.toggle('is-open', cesiumState.measureModeActive || cesiumState.measurePoints.length > 1);
        panel.setAttribute('aria-hidden', cesiumState.measureModeActive || cesiumState.measurePoints.length > 1 ? 'false' : 'true');
    }

    function clearCesiumMeasureEntities() {
        var viewer = cesiumState.viewer;
        if (viewer && Array.isArray(cesiumState.measureEntities)) {
            for (var i = 0; i < cesiumState.measureEntities.length; i++) {
                try {
                    viewer.entities.remove(cesiumState.measureEntities[i]);
                } catch (e) {
                    // ignore
                }
            }
        }
        cesiumState.measureEntities = [];
        cesiumState.measurePolyline = null;
        cesiumState.measureHoverPoint = null;
    }

    function clearCesiumMeasureLine(options) {
        var keepMode = options && options.keepMode === true;
        clearCesiumMeasureEntities();
        cesiumState.measurePoints = [];

        if (!keepMode) {
            cesiumState.measureModeActive = false;
        }

        updateMeasurePanel();
        if (cesiumState.viewer && cesiumState.viewer.scene && typeof cesiumState.viewer.scene.requestRender === 'function') {
            cesiumState.viewer.scene.requestRender();
        }
    }

    function addCesiumMeasurePoint(cartesian) {
        var viewer = cesiumState.viewer;
        if (!viewer || !cartesian) {
            return;
        }

        cesiumState.measurePoints.push(cartesian);

        var pointEntity = viewer.entities.add({
            position: cartesian,
            point: {
                pixelSize: 9,
                color: Cesium.Color.CYAN,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 1,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
        cesiumState.measureEntities.push(pointEntity);

        if (!cesiumState.measurePolyline) {
            cesiumState.measurePolyline = viewer.entities.add({
                polyline: {
                    positions: new Cesium.CallbackProperty(function() {
                        return cesiumState.measurePoints.slice();
                    }, false),
                    width: 3,
                    material: Cesium.Color.CYAN.withAlpha(0.85),
                    clampToGround: false,
                    arcType: Cesium.ArcType.GEODESIC
                }
            });
            cesiumState.measureEntities.push(cesiumState.measurePolyline);
        }

        updateMeasurePanel();
        if (viewer.scene && typeof viewer.scene.requestRender === 'function') {
            viewer.scene.requestRender();
        }
    }

    function pickCesiumMeasurePosition(windowPosition) {
        var viewer = cesiumState.viewer;
        if (!viewer || !windowPosition) {
            return null;
        }

        var picked = null;
        try {
            if (viewer.scene && viewer.scene.pickPositionSupported && typeof viewer.scene.pickPosition === 'function') {
                picked = viewer.scene.pickPosition(windowPosition);
            }
        } catch (e) {
            picked = null;
        }

        if (!picked && viewer.scene && viewer.scene.globe && typeof viewer.camera.getPickRay === 'function' && typeof viewer.scene.globe.pick === 'function') {
            try {
                var ray = viewer.camera.getPickRay(windowPosition);
                picked = ray ? viewer.scene.globe.pick(ray, viewer.scene) : null;
            } catch (e2) {
                picked = null;
            }
        }

        return picked;
    }

    function setCesiumMeasureMode(active) {
        var viewer = ensureViewer();
        if (!viewer) {
            return false;
        }

        var nextActive = !!active;
        cesiumState.measureModeActive = nextActive;

        if (nextActive) {
            clearCesiumMeasureLine({keepMode: true});
            cesiumState.measureModeActive = true;
            viewer.scene.screenSpaceCameraController.enableInputs = false;

            viewer.screenSpaceEventHandler.setInputAction(function(movement) {
                var cartesian = pickCesiumMeasurePosition(movement && movement.position);
                if (cartesian) {
                    addCesiumMeasurePoint(cartesian);
                }
            }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

            viewer.screenSpaceEventHandler.setInputAction(function(movement) {
                var cartesian = pickCesiumMeasurePosition(movement && movement.endPosition);
                if (cartesian) {
                    cesiumState.measureHoverPoint = cartesian;
                }
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

            viewer.screenSpaceEventHandler.setInputAction(function() {
                if (cesiumState.measurePoints.length >= 2) {
                    cesiumState.measureModeActive = false;
                    viewer.scene.screenSpaceCameraController.enableInputs = true;
                    viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
                    viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
                    viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
                    updateMeasurePanel();
                }
            }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

            updateMeasurePanel();
            return true;
        }

        viewer.scene.screenSpaceCameraController.enableInputs = true;
        viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
        viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
        updateMeasurePanel();
        return false;
    }

    function toggleCesiumMeasureMode() {
        if (cesiumState.measureModeActive) {
            return setCesiumMeasureMode(false);
        }
        return setCesiumMeasureMode(true);
    }

    function syncCameraStateFromViewer() {
        if (!cesiumState.viewer || !cesiumState.viewer.camera) {
            return;
        }

        cesiumState.camera.heading = Cesium.Math.toDegrees(cesiumState.viewer.camera.heading);
        cesiumState.camera.pitch = Cesium.Math.toDegrees(cesiumState.viewer.camera.pitch);
        cesiumState.camera.range = clampNumber(cesiumState.viewer.camera.positionCartographic && cesiumState.viewer.camera.positionCartographic.height, 1000, 50000, cesiumState.camera.range);
        persistCameraState();
        updateCameraSliderDisplay();
    }

    function applyCameraState(state) {
        var next = state || {};
        cesiumState.camera.heading = clampNumber(next.heading, -180, 180, cesiumState.camera.heading);
        cesiumState.camera.pitch = clampNumber(next.pitch, -89, -5, cesiumState.camera.pitch);
        cesiumState.camera.range = clampNumber(next.range, 1000, 50000, cesiumState.camera.range);
        persistCameraState();
    }

    function getCameraOffset(options) {
        var state = cesiumState.camera;
        var next = options || {};
        return new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(typeof next.heading === 'number' ? next.heading : state.heading),
            Cesium.Math.toRadians(typeof next.pitch === 'number' ? next.pitch : state.pitch),
            clampNumber(typeof next.range === 'number' ? next.range : state.range, 1000, 50000, state.range)
        );
    }

    function hasCesium() {
        return typeof Cesium !== 'undefined' && typeof document !== 'undefined';
    }

    function getCesiumContainer() {
        return document.getElementById('cesiumMap');
    }

    function getCesiumCameraSliderPanel() {
        return document.getElementById('cesiumCameraSliderPanel');
    }

    function getCesiumCameraSliderInput() {
        return document.getElementById('cesiumCameraSliderInput');
    }

    function getCesiumCameraSliderValue() {
        return document.getElementById('cesiumCameraSliderValue');
    }

    function getCesiumCameraSliderTitle() {
        return document.getElementById('cesiumCameraSliderTitle');
    }

    function toCesiumColor(color) {
        try {
            if (typeof color === 'string' && color.length > 0) {
                return Cesium.Color.fromCssColorString(color);
            }
        } catch (e) {
            // fall through to default color
        }
        return Cesium.Color.WHITE;
    }

    function toCesiumPoint(point) {
        if (!point) {
            return null;
        }

        if (Array.isArray(point) && point.length >= 2) {
            return [parseFloat(point[0]), parseFloat(point[1]), parseFloat(point.length > 2 ? point[2] : 0) || 0];
        }

        if (typeof point === 'object') {
            if (point.hasOwnProperty('lat') && point.hasOwnProperty('lng')) {
                return [parseFloat(point.lat), parseFloat(point.lng), parseFloat(point.alt || point.height || 0) || 0];
            }
            if (point.hasOwnProperty('latitude') && point.hasOwnProperty('longitude')) {
                return [parseFloat(point.latitude), parseFloat(point.longitude), parseFloat(point.altitude || 0) || 0];
            }
        }

        return null;
    }

    function toCesiumPosition(point) {
        var normalized = toCesiumPoint(point);
        if (!normalized || !isFinite(normalized[0]) || !isFinite(normalized[1])) {
            return null;
        }
        return Cesium.Cartesian3.fromDegrees(normalized[1], normalized[0], normalized[2] || 0);
    }

    function toCesiumPointList(points) {
        if (!Array.isArray(points)) {
            return [];
        }

        var positions = [];
        points.forEach(function(point) {
            var normalized = toCesiumPoint(point);
            if (normalized && isFinite(normalized[0]) && isFinite(normalized[1])) {
                positions.push(normalized);
            }
        });
        return positions;
    }

    function densifyCesiumPointList(points, maxSegmentMeters) {
        var normalizedPoints = toCesiumPointList(points);
        if (normalizedPoints.length < 2) {
            return normalizedPoints;
        }

        var stepMeters = clampNumber(maxSegmentMeters, 1000, 100000, 25000);
        var output = [];

        for (var i = 0; i < normalizedPoints.length - 1; i++) {
            var start = normalizedPoints[i];
            var end = normalizedPoints[i + 1];
            var startCartographic = Cesium.Cartographic.fromDegrees(start[1], start[0], start[2] || 0);
            var endCartographic = Cesium.Cartographic.fromDegrees(end[1], end[0], end[2] || 0);
            var geodesic = new Cesium.EllipsoidGeodesic(startCartographic, endCartographic);
            var segmentDistance = geodesic.surfaceDistance || 0;
            var subdivisions = Math.max(1, Math.min(20, Math.ceil(segmentDistance / stepMeters)));

            for (var j = 0; j <= subdivisions; j++) {
                if (i > 0 && j === 0) {
                    continue;
                }

                var fraction = subdivisions === 0 ? 0 : (j / subdivisions);
                var cartographic = geodesic.interpolateUsingFraction(fraction);
                var altitude = Cesium.Math.lerp(start[2] || 0, end[2] || 0, fraction);
                output.push([
                    Cesium.Math.toDegrees(cartographic.latitude),
                    Cesium.Math.toDegrees(cartographic.longitude),
                    altitude
                ]);
            }
        }

        return output;
    }

    // Cap on how many track points are pushed into a Cesium polyline per update.
    // The balloon and chase-car tracks grow unbounded over a flight; rebuilding
    // (and densifying) the whole array every telemetry tick is O(n) per tick and
    // O(n^2) over the flight. Keeping only the most recent N points bounds the
    // per-tick cost. The 2D Leaflet layers keep the full trail. Configurable via
    // chase_config.cesium_max_track_points.
    function getMaxTrackPoints() {
        try {
            if (typeof chase_config !== 'undefined' && chase_config && chase_config.cesium_max_track_points) {
                var n = parseInt(chase_config.cesium_max_track_points, 10);
                if (isFinite(n) && n > 1) {
                    return n;
                }
            }
        } catch (e) {
            // ignore and use default
        }
        return 2000;
    }

    function toCesiumPositionList(points, options) {
        var listOptions = options || {};
        // Optionally keep only the most recent maxPoints entries (the tail).
        if (listOptions.maxPoints && Array.isArray(points) && points.length > listOptions.maxPoints) {
            points = points.slice(points.length - listOptions.maxPoints);
        }
        var normalizedPoints = listOptions.densify === false ? toCesiumPointList(points) : densifyCesiumPointList(points, listOptions.maxSegmentMeters);
        var positions = [];

        normalizedPoints.forEach(function(point) {
            var cartesian = toCesiumPosition(point);
            if (cartesian) {
                positions.push(cartesian);
            }
        });

        return positions;
    }

    function clearBuildingsTileset() {
        var viewer = cesiumState.viewer;
        if (!viewer || !cesiumState.buildingsTileset) {
            if (viewer && cesiumState.buildingsDataSource) {
                try {
                    viewer.dataSources.remove(cesiumState.buildingsDataSource, true);
                } catch (e) {
                    // ignore remove failures
                }
                cesiumState.buildingsDataSource = null;
            }
            return;
        }

        try {
            viewer.scene.primitives.remove(cesiumState.buildingsTileset);
        } catch (e) {
            // ignore remove failures
        }
        cesiumState.buildingsTileset = null;

        if (viewer && cesiumState.buildingsDataSource) {
            try {
                viewer.dataSources.remove(cesiumState.buildingsDataSource, true);
            } catch (e2) {
                // ignore remove failures
            }
            cesiumState.buildingsDataSource = null;
        }
    }

    function getBuildingsFallbackBounds() {
        var lat = 0;
        var lon = 0;

        try {
            if (typeof map !== 'undefined' && map && typeof map.getCenter === 'function') {
                var center = map.getCenter();
                if (center && typeof center.lat === 'number' && typeof center.lng === 'number') {
                    lat = center.lat;
                    lon = center.lng;
                }
            }
        } catch (e) {
            // ignore map lookup failures
        }

        try {
            if ((!lat || !lon) && typeof chase_config !== 'undefined' && chase_config) {
                if (isFinite(parseFloat(chase_config.default_lat))) {
                    lat = parseFloat(chase_config.default_lat);
                }
                if (isFinite(parseFloat(chase_config.default_lon))) {
                    lon = parseFloat(chase_config.default_lon);
                }
            }
        } catch (e2) {
            // ignore config lookup failures
        }

        return {
            south: Math.max(-90, lat - 0.025),
            west: Math.max(-180, lon - 0.03),
            north: Math.min(90, lat + 0.025),
            east: Math.min(180, lon + 0.03)
        };
    }

    function loadFallbackBuildingsDataSource(viewer) {
        if (!viewer || typeof Cesium.GeoJsonDataSource !== 'function' || typeof fetch !== 'function') {
            return Promise.reject(new Error('Fallback buildings source is unavailable.'));
        }

        var bounds = getBuildingsFallbackBounds();
        var overpassQuery = [
            '[out:json][timeout:25];',
            '(',
            'way["building"](' + bounds.south + ',' + bounds.west + ',' + bounds.north + ',' + bounds.east + ');',
            'relation["building"](' + bounds.south + ',' + bounds.west + ',' + bounds.north + ',' + bounds.east + ');',
            ');',
            'out body;',
            '>;',
            'out skel qt;'
        ].join(' ');

        var overpassEndpoints = [
            'https://overpass.kumi.systems/api/interpreter',
            'https://lz4.overpass-api.de/api/interpreter'
        ];

        var requestBody = 'data=' + encodeURIComponent(overpassQuery);

        var requestOverpass = function(endpointIndex) {
            var endpoint = overpassEndpoints[endpointIndex];
            if (!endpoint) {
                return Promise.reject(new Error('No Overpass endpoint available.'));
            }

            return fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            },
            body: requestBody
            }).then(function(response) {
            if (!response.ok) {
                throw new Error('Overpass request failed with status ' + response.status);
            }
            return response.json();
            }).catch(function(err) {
                if (endpointIndex + 1 < overpassEndpoints.length) {
                    return requestOverpass(endpointIndex + 1);
                }
                throw err;
            });
        };

        return requestOverpass(0).then(function(payload) {
            var nodeIndex = {};
            var features = [];

            if (!payload || !Array.isArray(payload.elements)) {
                throw new Error('Invalid Overpass response.');
            }

            payload.elements.forEach(function(element) {
                if (element.type === 'node' && typeof element.id !== 'undefined') {
                    nodeIndex[element.id] = {
                        lat: element.lat,
                        lon: element.lon
                    };
                }
            });

            payload.elements.forEach(function(element) {
                if (element.type !== 'way' || !Array.isArray(element.nodes) || element.nodes.length < 4) {
                    return;
                }

                var ring = [];
                element.nodes.forEach(function(nodeId) {
                    var node = nodeIndex[nodeId];
                    if (node && typeof node.lat === 'number' && typeof node.lon === 'number') {
                        ring.push([node.lon, node.lat]);
                    }
                });

                if (ring.length < 4) {
                    return;
                }

                var first = ring[0];
                var last = ring[ring.length - 1];
                if (first[0] !== last[0] || first[1] !== last[1]) {
                    ring.push([first[0], first[1]]);
                }

                var height = 12;
                if (element.tags && element.tags.height) {
                    height = parseFloat(element.tags.height) || height;
                } else if (element.tags && element.tags['building:levels']) {
                    height = (parseFloat(element.tags['building:levels']) || 4) * 3;
                }

                features.push({
                    type: 'Feature',
                    properties: {
                        height: height,
                        name: element.tags && element.tags.name ? element.tags.name : ''
                    },
                    geometry: {
                        type: 'Polygon',
                        coordinates: [ring]
                    }
                });
            });

            if (features.length === 0) {
                throw new Error('No building footprints were returned for the current view.');
            }

            var dataSourcePromise = Cesium.GeoJsonDataSource.load({
                type: 'FeatureCollection',
                features: features
            }, {
                clampToGround: false
            });

            return Promise.resolve(dataSourcePromise).then(function(dataSource) {
                var entities = dataSource.entities.values;
                for (var i = 0; i < entities.length; i++) {
                    var entity = entities[i];
                    if (!entity.polygon) {
                        continue;
                    }

                    var extrudedHeight = entity.properties && entity.properties.height ? parseFloat(entity.properties.height.getValue()) : 12;
                    if (!isFinite(extrudedHeight) || extrudedHeight <= 0) {
                        extrudedHeight = 12;
                    }

                    entity.polygon.material = Cesium.Color.fromCssColorString('#cfc4b0').withAlpha(0.78);
                    entity.polygon.outline = false;
                    entity.polygon.height = 0;
                    entity.polygon.extrudedHeight = extrudedHeight;
                }

                viewer.dataSources.add(dataSource);
                cesiumState.buildingsDataSource = dataSource;
                if (typeof viewer.scene.requestRender === 'function') {
                    viewer.scene.requestRender();
                }
                return dataSource;
            });
        });
    }

    function getTerrainProviderPromise(modeId) {
        if (!modeUsesTerrain(modeId)) {
            return Promise.resolve(new Cesium.EllipsoidTerrainProvider());
        }

        try {
            if (typeof Cesium.ArcGISTiledElevationTerrainProvider === 'function' && typeof Cesium.ArcGISTiledElevationTerrainProvider.fromUrl === 'function') {
                return Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
                    'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer'
                );
            }
            if (typeof Cesium.createWorldTerrainAsync === 'function') {
                return Cesium.createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true });
            }
            if (typeof Cesium.createWorldTerrain === 'function') {
                return Promise.resolve(Cesium.createWorldTerrain({ requestVertexNormals: true, requestWaterMask: true }));
            }
            if (typeof Cesium.CesiumTerrainProvider === 'function') {
                return Promise.resolve(new Cesium.CesiumTerrainProvider({
                    url: 'https://assets.agi.com/stk-terrain/world',
                    requestVertexNormals: true,
                    requestWaterMask: true
                }));
            }
        } catch (e) {
            console.warn('Unable to initialize terrain provider, falling back to ellipsoid terrain.', e);
        }

        return Promise.resolve(new Cesium.EllipsoidTerrainProvider());
    }

    function applyCesiumMapMode(modeId, options) {
        var viewer = ensureViewer();
        if (!viewer) {
            return;
        }

        var opts = options || {};
        var normalized = normalizeMapMode(modeId || getStoredMapMode());
        cesiumState.mapMode = normalized;

        if (opts.persist !== false) {
            persistMapMode(normalized);
        }

        if (typeof chase_config !== 'undefined' && chase_config) {
            chase_config.cesium_map_mode = normalized;
        }

        var applySeq = ++cesiumState.mapModeApplySeq;
        var imageryProvider = null;
        try {
            imageryProvider = createImageryProviderForMode(normalized);
        } catch (imageryErr) {
            console.warn('Failed to create imagery provider for mode ' + normalized + ', reverting to standard.', imageryErr);
            normalized = 'standard';
            imageryProvider = createImageryProviderForMode(normalized);
            cesiumState.mapMode = normalized;
            if (opts.persist !== false) {
                persistMapMode(normalized);
            }
        }

        try {
            viewer.imageryLayers.removeAll(false);
            viewer.imageryLayers.addImageryProvider(imageryProvider);
        } catch (imageryApplyErr) {
            console.warn('Failed to apply imagery provider for mode ' + normalized + '.', imageryApplyErr);
        }

        getTerrainProviderPromise(normalized).then(function(terrainProvider) {
            if (!cesiumState.viewer || applySeq !== cesiumState.mapModeApplySeq) {
                return;
            }

            try {
                viewer.terrainProvider = terrainProvider || new Cesium.EllipsoidTerrainProvider();
                try {
                    viewer.scene.globe.enableLighting = modeUsesTerrain(normalized);
                    viewer.scene.globe.depthTestAgainstTerrain = modeUsesTerrain(normalized);
                } catch (e) {}
            } catch (terrainErr) {
                console.warn('Failed to apply terrain provider, reverting to ellipsoid terrain.', terrainErr);
                viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
            }

            clearBuildingsTileset();

            if (modeUsesBuildings(normalized)) {
                try {
                    loadFallbackBuildingsDataSource(viewer).catch(function(fallbackErr) {
                        console.warn('Unable to load fallback 3D buildings data for mode ' + normalized + '.', fallbackErr);
                    });
                } catch (buildingsErr) {
                    console.warn('Unable to initialize 3D buildings mode.', buildingsErr);
                }
            }

            if (typeof viewer.scene.requestRender === 'function') {
                viewer.scene.requestRender();
            }
        }).catch(function(terrainPromiseErr) {
            console.warn('Terrain initialization failed for mode ' + normalized + '.', terrainPromiseErr);
            try {
                viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
            } catch (fallbackErr) {
                // ignore
            }
            clearBuildingsTileset();
        });
    }

    function ensureViewer() {
        if (!hasCesium()) {
            return null;
        }

        if (cesiumState.viewer) {
            return cesiumState.viewer;
        }

        var container = getCesiumContainer();
        if (!container) {
            return null;
        }

        // Show loader overlay if present
        try {
            var loaderEl = document.getElementById('cesiumLoader');
            if (loaderEl) {
                loaderEl.style.display = 'block';
            }
        } catch (e) {
            // ignore
        }

        var viewer = new Cesium.Viewer(container, {
            animation: false,
            // Disable Cesium's default base layer so it does not request Ion world imagery.
            baseLayer: false,
            imageryProvider: false,
            baseLayerPicker: false,
            fullscreenButton: false,
            geocoder: false,
            homeButton: false,
            infoBox: false,
            navigationHelpButton: false,
            sceneModePicker: false,
            selectionIndicator: false,
            timeline: false,
            shouldAnimate: true,
            terrainProvider: new Cesium.EllipsoidTerrainProvider()
        });

        try {
            viewer.imageryLayers.removeAll();
            viewer.imageryLayers.addImageryProvider(new Cesium.OpenStreetMapImageryProvider({
                url: 'https://tile.openstreetmap.org/'
            }));
        } catch (e) {
            console.warn('Cesium imagery setup failed', e);
        }

        viewer.scene.globe.depthTestAgainstTerrain = true;
        viewer.scene.skyAtmosphere.show = true;
        viewer.scene.sun.show = false;
        viewer.scene.moon.show = false;

        applyCameraState(getStoredCameraState());

        cesiumState.viewer = viewer;

        try {
            viewer.camera.moveEnd.addEventListener(function() {
                syncCameraStateFromViewer();
            });
        } catch (e) {
            // ignore
        }

        // Notify index.html of a genuine user gesture (mouse-drag start,
        // scroll-wheel zoom, touch drag/pinch) so it can turn off auto-follow -
        // registered on viewer.screenSpaceEventHandler, a separate listener
        // registry from the camera controller's own internal one, so this
        // doesn't interfere with the built-in drag-to-pan/scroll-to-zoom
        // behaviour. Deliberately keyed off raw input rather than
        // camera.moveEnd, which also fires for our own programmatic
        // flyTo calls (follow, focus, mode switches) and can't cheaply be
        // told apart from a real user drag.
        try {
            var notifyUserMapInteraction = function() {
                if (typeof window.onCesiumUserMapInteraction === 'function') {
                    window.onCesiumUserMapInteraction();
                }
            };
            viewer.screenSpaceEventHandler.setInputAction(notifyUserMapInteraction, Cesium.ScreenSpaceEventType.LEFT_DOWN);
            viewer.screenSpaceEventHandler.setInputAction(notifyUserMapInteraction, Cesium.ScreenSpaceEventType.WHEEL);
            viewer.screenSpaceEventHandler.setInputAction(notifyUserMapInteraction, Cesium.ScreenSpaceEventType.PINCH_START);
        } catch (e) {
            // ignore
        }

        try {
            viewer.screenSpaceEventHandler.setInputAction(function(movement) {
                var picked = viewer.scene.pick(movement.position);
                if (!picked || !picked.id || typeof picked.id.id !== 'string') {
                    hideCesiumCameraSlider();
                    return;
                }

                var pickedId = picked.id.id;
                var suffix = ':track';
                if (pickedId.slice(-suffix.length) !== suffix) {
                    hideCesiumCameraSlider();
                    return;
                }

                var csKey = pickedId.slice(0, -suffix.length).toUpperCase();
                if (!csKey) {
                    hideCesiumCameraSlider();
                    return;
                }

                if (csKey === 'CHASE_CAR') {
                    hideCesiumCameraSlider();
                    return;
                }

                cesiumState.camera.focus = {
                    type: 'callsign',
                    callsign: csKey
                };
                hideCesiumCameraSlider();
                focusCesiumOnCallsign(csKey, {duration: 0.8});

                // Clicking a callsign in 3D should open APRS list and highlight it.
                if (typeof window !== 'undefined' && typeof window.showAprsPanel === 'function') {
                    try {
                        window.showAprsPanel(csKey);
                    } catch (panelErr) {
                        console.warn('Unable to open APRS panel for', csKey, panelErr);
                    }
                }
            }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        } catch (e) {
            // ignore click binding failures
        }

        // If a Leaflet map center exists, move the Cesium camera there for a visible view
        try {
            if (typeof map !== 'undefined' && map && typeof map.getCenter === 'function') {
                var c = map.getCenter();
                if (c && typeof c.lat === 'number' && typeof c.lng === 'number') {
                    viewer.camera.setView({
                        destination: Cesium.Cartesian3.fromDegrees(c.lng, c.lat, 5000),
                        orientation: {
                            heading: Cesium.Math.toRadians(cesiumState.camera.heading),
                            pitch: Cesium.Math.toRadians(cesiumState.camera.pitch),
                            roll: 0
                        }
                    });
                    syncCameraStateFromViewer();
                }
            }
        } catch (e) {
            // ignore
        }

        // Hide loader overlay if present
        try {
            var loaderEl2 = document.getElementById('cesiumLoader');
            if (loaderEl2) {
                loaderEl2.style.display = 'none';
            }
        } catch (e) {
            // ignore
        }

        // Apply the selected imagery/terrain/tiles mode once the viewer exists.
        try {
            applyCesiumMapMode(getStoredMapMode(), {persist: false});
        } catch (modeErr) {
            console.warn('Unable to apply stored 3D map mode.', modeErr);
        }

        return viewer;
    }

    function setContainerVisible(active) {
        var mapContainer = document.getElementById('map');
        var cesiumContainer = getCesiumContainer();

        // When Cesium (3D) is active, hide the Leaflet container so it isn't
        // rendering tiles/markers underneath the 3D canvas. Leaflet remains the
        // source of truth for state (layers persist in memory); only its
        // container is hidden. Leaflet's controls are reparented to <body> in
        // moveLeafletControlsToBody() so they stay usable while #map is hidden.
        // Switching back to 2D calls map.invalidateSize() to re-measure/redraw.
        if (mapContainer) {
            mapContainer.style.display = active ? 'none' : '';
            mapContainer.setAttribute('aria-hidden', active ? 'true' : 'false');
        }

        if (cesiumContainer) {
            cesiumContainer.style.display = active ? 'block' : 'none';
            cesiumContainer.setAttribute('aria-hidden', active ? 'false' : 'true');
        }
    }

    function setCesiumEntityVisible(entity, visible) {
        if (!entity) {
            return;
        }
        entity.show = visible !== false;
    }

    function upsertBalloonEntity(callsign, kind, options) {
        var viewer = ensureViewer();
        if (!viewer) {
            return null;
        }

        var id = callsign + ':' + kind;
        var entity = viewer.entities.getById(id);
        if (!entity) {
            entity = viewer.entities.add({
                id: id,
                name: callsign + ' ' + kind
            });
        }

        if (options.position) {
            entity.position = options.position;
        }
        if (options.point) {
            entity.point = options.point;
        }
        if (options.label) {
            entity.label = options.label;
        }
        if (options.polyline) {
            entity.polyline = options.polyline;
        }
        if (options.billboard) {
            entity.billboard = options.billboard;
        }

        entity.show = options.show !== false;
        return entity;
    }

    function syncBalloonEntity(callsign, payload) {
        var viewer = cesiumState.viewer;
        if (!viewer || !cesiumState.active) {
            return;
        }

        var balloonState = (typeof balloon_positions !== 'undefined' && balloon_positions.hasOwnProperty(callsign)) ? balloon_positions[callsign] : null;
        var latest = payload && payload.telem ? payload.telem : (balloonState ? balloonState.latest_data : null);
        if (!latest || !Array.isArray(latest.position)) {
            return;
        }

        var position = toCesiumPosition(latest.position);
        if (!position) {
            return;
        }

        var colour = payload && payload.colour ? payload.colour : (balloonState && balloonState.colour ? balloonState.colour : 'blue');
        var visible = payload && payload.visible !== undefined ? !!payload.visible : (balloonState ? balloonState.visible !== false : true);
        var callsignLabel = callsign;
        
        // Determine balloon state and select appropriate icon
        var alt = parseFloat(latest.position[2]) || 0;
        var parachute_min_alt = typeof window.parachute_min_alt !== 'undefined' ? window.parachute_min_alt : 300;
        var vel_v = parseFloat(latest.vel_v) || 0;
        
        var iconUrl;
        var iconWidth = 46;
        var iconHeight = 85;
        var iconOffsetX = 23;
        var iconOffsetY = 76;
        
        if (alt < parachute_min_alt) {
            // Landed - use payload icon
            iconUrl = '/static/img/payload-' + colour + '.png';
            iconWidth = 17;
            iconHeight = 18;
            iconOffsetX = 8;
            iconOffsetY = 14;
        } else if (vel_v < 0) {
            // Descending - use parachute icon
            iconUrl = '/static/img/parachute-' + colour + '.png';
            iconHeight = 84;
        } else {
            // Ascending - use balloon icon
            iconUrl = '/static/img/balloon-' + colour + '.png';
        }

        upsertBalloonEntity(callsign, 'track', {
            show: visible,
            billboard: {
                image: iconUrl,
                width: iconWidth,
                height: iconHeight,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            position: position
        });

        var path = toCesiumPositionList((payload && payload.pathData) || (balloonState && balloonState.path) || [], {maxSegmentMeters: 15000, maxPoints: getMaxTrackPoints()});
        upsertBalloonEntity(callsign, 'path', {
            show: visible && path.length >= 2,
            polyline: {
                positions: path,
                clampToGround: false,
                width: 2,
                arcType: Cesium.ArcType.GEODESIC,
                material: toCesiumColor(colour)
            }
        });

        var predPath = toCesiumPositionList((payload && payload.predPathData) || (balloonState && balloonState.pred_path) || [], {maxSegmentMeters: 12000});
        upsertBalloonEntity(callsign, 'prediction', {
            show: visible && predPath.length >= 2,
            polyline: {
                positions: predPath,
                clampToGround: false,
                width: 3,
                arcType: Cesium.ArcType.GEODESIC,
                material: toCesiumColor(colour).withAlpha(0.6)  // Matched Leaflet opacity of 0.6
            }
        });

        var predLanding = toCesiumPosition((payload && payload.predLandingData) || (balloonState && balloonState.pred_marker) || null);
        upsertBalloonEntity(callsign, 'landing', {
            show: visible && !!predLanding,
            position: predLanding,
            billboard: {
                image: '/static/img/target-' + colour + '.png',
                width: 20,
                height: 20,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });

        var burst = toCesiumPosition((payload && payload.burstData) || (balloonState && balloonState.burst_marker) || null);
        upsertBalloonEntity(callsign, 'burst', {
            show: visible && !!burst,
            position: burst,
            billboard: {
                image: '/static/img/balloon-pop.png',
                width: 20,
                height: 20,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });

        var abortEnabled = (typeof chase_config === 'undefined' || !chase_config) ? true : chase_config.show_abort !== false;
        var abortPath = toCesiumPositionList((payload && payload.abortPathData) || (balloonState && balloonState.abort_path) || [], {maxSegmentMeters: 12000});
        upsertBalloonEntity(callsign, 'abort-path', {
            show: visible && abortEnabled && abortPath.length >= 2,
            polyline: {
                positions: abortPath,
                clampToGround: false,
                width: 2,
                arcType: Cesium.ArcType.GEODESIC,
                material: Cesium.Color.RED.withAlpha(0.6)  // Matched Leaflet opacity of 0.6
            }
        });

        var abortLanding = toCesiumPosition((payload && payload.abortLandingData) || (balloonState && balloonState.abort_marker) || null);
        upsertBalloonEntity(callsign, 'abort', {
            show: visible && abortEnabled && !!abortLanding,
            position: abortLanding,
            billboard: {
                image: '/static/img/target-red.png',
                width: 20,
                height: 20,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
    }

    function syncChaseCarEntity() {
        var viewer = cesiumState.viewer;
        if (!viewer || !cesiumState.active || typeof chase_car_position === 'undefined' || !chase_car_position) {
            return;
        }

        // Check if we have valid position data
        var latest = chase_car_position.latest_data;
        if (!Array.isArray(latest) || latest.length < 2) {
            return;
        }

        var normalized = toCesiumPoint(latest);
        if (!normalized || !isFinite(normalized[0]) || !isFinite(normalized[1])) {
            return;
        }

        // chase_car_position.path is a plain array of [lat,lon,alt] breadcrumb
        // points; trackVisible mirrors the "chaseCarTrack" display setting.
        var trackVisible = chase_car_position.trackVisible !== false;
        var pathPoints = [];
        if (trackVisible && Array.isArray(chase_car_position.path) && chase_car_position.path.length > 0) {
            pathPoints = toCesiumPositionList(chase_car_position.path, {maxSegmentMeters: 10000, maxPoints: getMaxTrackPoints()});
        }

        function placeCarEntity(position) {
            cesiumState.chaseCarEntity = upsertBalloonEntity('CHASE_CAR', 'track', {
                show: true,
                position: position,
                billboard: {
                    image: '/static/img/car-blue.png',
                    width: 55,
                    height: 25,
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    verticalOrigin: Cesium.VerticalOrigin.CENTER,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                },
                polyline: {
                    positions: pathPoints.length >= 2 ? pathPoints : [position, position],
                    show: pathPoints.length >= 2,
                    clampToGround: true,
                    width: 2,
                    arcType: Cesium.ArcType.GEODESIC,
                    material: Cesium.Color.BLACK
                }
            });
        }

        var fallbackPos = Cesium.Cartesian3.fromDegrees(normalized[1], normalized[0], normalized[2] || 0);

        // Sample terrain to place the chase car exactly on the ground where possible.
        if (viewer.terrainProvider && typeof Cesium.sampleTerrainMostDetailed === 'function') {
            try {
                var carto = Cesium.Cartographic.fromDegrees(normalized[1], normalized[0], normalized[2] || 0);
                Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [carto]).then(function(updated){
                    var u = updated && updated[0] ? updated[0] : carto;
                    placeCarEntity(Cesium.Cartesian3.fromRadians(u.longitude, u.latitude, u.height || 0));
                }).catch(function(){
                    placeCarEntity(fallbackPos);
                });
            } catch (e) {
                placeCarEntity(fallbackPos);
            }
        } else {
            placeCarEntity(fallbackPos);
        }
    }

    // Render another connected chaser's live position as a Cesium billboard +
    // label. Simpler than syncChaseCarEntity() (no terrain sampling or
    // breadcrumb trail) since this is just a supplementary "where is everyone
    // else" marker, not the primary navigation-focused car.
    function syncOtherChaserEntity(key, name, vehicle) {
        var viewer = cesiumState.viewer;
        if (!viewer || !cesiumState.active || !vehicle) {
            return;
        }

        var pos = toCesiumPosition(vehicle.latest_data);
        if (!pos) {
            return;
        }

        upsertBalloonEntity('OTHER_CAR_' + key, 'track', {
            show: !!vehicle.onmap,
            position: pos,
            billboard: {
                image: '/static/img/car-' + (vehicle.colour || 'green') + '.png',
                width: 55,
                height: 25,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                text: name || key,
                font: '14px sans-serif',
                pixelOffset: new Cesium.Cartesian2(0, 22),
                fillColor: Cesium.Color.WHITE,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
    }

    // Show a polyline route on the Cesium map. Expects an array of {lat, lng} objects.
    function showChaseRouteOnCesium(latlngs) {
        var viewer = cesiumState.viewer;
        if (!viewer || !cesiumState.active || !Array.isArray(latlngs) || latlngs.length === 0) {
            return;
        }
        // Prepare cartographics for terrain sampling (latlngs may be {lat,lng}
        // objects or plain [lat,lon] arrays - toCesiumPoint accepts both).
        try {
            var normalizedPoints = toCesiumPointList(latlngs);
            var cartos = normalizedPoints.map(function(p){ return Cesium.Cartographic.fromDegrees(p[1], p[0]); });
            if (viewer.terrainProvider && typeof Cesium.sampleTerrainMostDetailed === 'function') {
                Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartos).then(function(updated){
                    try {
                        var positions = updated.map(function(c){ return Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height || 0); });
                        var id = 'CHASE_ROUTE:route';
                        var entity = viewer.entities.getById(id);
                        if (!entity) { entity = viewer.entities.add({ id: id }); }
                        entity.polyline = {
                            positions: positions,
                            width: 4,
                            material: Cesium.Color.YELLOW.withAlpha(0.9),
                            clampToGround: false,
                            arcType: Cesium.ArcType.GEODESIC
                        };
                        entity.show = true;
                        cesiumState.routeEntity = entity;
                        if (typeof viewer.scene.requestRender === 'function') viewer.scene.requestRender();
                    } catch (e) {
                        console.warn('Failed to create sampled route', e);
                    }
                }).catch(function(err){
                    // Fall back to ground-clamped polyline if sampling failed
                    var positions = toCesiumPositionList(latlngs, {densify: false});
                    var id = 'CHASE_ROUTE:route';
                    var entity = viewer.entities.getById(id) || viewer.entities.add({ id: id });
                    entity.polyline = {
                        positions: positions,
                        width: 4,
                        material: Cesium.Color.YELLOW.withAlpha(0.9),
                        clampToGround: true,
                        arcType: Cesium.ArcType.GEODESIC
                    };
                    entity.show = true;
                    cesiumState.routeEntity = entity;
                    if (typeof viewer.scene.requestRender === 'function') viewer.scene.requestRender();
                });
                return;
            }
        } catch (e) {
            // ignore and fall back
        }

        // Fallback: draw ground-clamped polyline without sampled heights
        var positions = toCesiumPositionList(latlngs, {densify: false});
        if (!positions || positions.length === 0) return;
        var id = 'CHASE_ROUTE:route';
        var entity = viewer.entities.getById(id);
        if (!entity) { entity = viewer.entities.add({ id: id }); }
        entity.polyline = {
            positions: positions,
            width: 4,
            material: Cesium.Color.YELLOW.withAlpha(0.9),
            clampToGround: true,
            arcType: Cesium.ArcType.GEODESIC
        };
        entity.show = true;
        cesiumState.routeEntity = entity;
        if (typeof viewer.scene.requestRender === 'function') viewer.scene.requestRender();
    }

    function clearChaseRouteOnCesium() {
        var viewer = cesiumState.viewer;
        if (!viewer) return;
        try {
            if (cesiumState.routeEntity) {
                try { viewer.entities.remove(cesiumState.routeEntity); } catch (e) {}
                cesiumState.routeEntity = null;
            } else {
                var e = viewer.entities.getById('CHASE_ROUTE:route');
                if (e) {
                    try { viewer.entities.remove(e); } catch (ee) {}
                }
            }
            if (typeof viewer.scene.requestRender === 'function') viewer.scene.requestRender();
        } catch (e) {
            // ignore
        }
    }

    function syncHomeEntity() {
        var viewer = cesiumState.viewer;
        if (!viewer || !cesiumState.active || typeof chase_config === 'undefined' || !chase_config) {
            return;
        }

        var lat = parseFloat(chase_config.default_lat);
        var lon = parseFloat(chase_config.default_lon);
        var alt = parseFloat(chase_config.default_alt || 0);
        if (!isFinite(lat) || !isFinite(lon)) {
            if (cesiumState.homeEntity) {
                cesiumState.homeEntity.show = false;
            }
            return;
        }

        var homePosition = toCesiumPosition([lat, lon, isFinite(alt) ? alt : 0]);
        if (!homePosition) {
            return;
        }

        cesiumState.homeEntity = upsertBalloonEntity('HOME', 'station', {
            show: true,
            position: homePosition,
            // Native Cesium point graphics for the current-location marker - a
            // simple blue dot with a white ring, like Google/Apple Maps. This
            // replaces a hand-drawn canvas billboard that was sized 32x48 for
            // a 36x36 square image, which squashed the circle into an oval and
            // (via verticalOrigin: BOTTOM, meant for pin-shaped icons) floated
            // it above the actual coordinate instead of centering on it.
            point: {
                pixelSize: 14,
                color: Cesium.Color.fromCssColorString('#1E86FF'),
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 3,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            // No label text to keep the marker as a simple blue dot (matches Leaflet circleMarker)
            label: {
                text: '',
                show: false
            }
        });
        if (cesiumState.homeEntity) {
            cesiumState.homeEntity.billboard = undefined;
        }
    }

    // The browser's own geolocation fix (distinct from the configured
    // home/receiver position above) - same blue-dot-with-white-ring styling.
    function syncUserLocationOnCesium(position) {
        var viewer = ensureViewer();
        if (!viewer) {
            return;
        }
        var pos = toCesiumPosition(position);
        if (!pos) {
            return;
        }
        upsertBalloonEntity('USER_LOCATION', 'marker', {
            show: true,
            position: pos,
            point: {
                pixelSize: 14,
                color: Cesium.Color.fromCssColorString('#2E86FF'),
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
    }

    // Remove another connected chaser's marker entity entirely (as opposed to
    // just hiding it) - used when a chaser disconnects/goes stale rather than
    // just toggling the "show other chasers" checkbox.
    function removeOtherChaserEntity(key) {
        var viewer = cesiumState.viewer;
        if (!viewer) {
            return;
        }
        try { viewer.entities.removeById('OTHER_CAR_' + key + ':track'); } catch (e) { /* ignore */ }
    }

    // Hide (not remove) the chase-car entity - used when switching to a
    // profile with no live car position source (e.g. "station" or "none").
    function clearChaseCarOnCesium() {
        if (cesiumState.chaseCarEntity) {
            cesiumState.chaseCarEntity.show = false;
        }
    }

    function clearRangeRingsOnCesium() {
        var viewer = cesiumState.viewer;
        if (viewer) {
            cesiumState.rangeRingEntities.forEach(function(entity) {
                try { viewer.entities.remove(entity); } catch (e) { /* ignore */ }
            });
        }
        cesiumState.rangeRingEntities = [];
    }

    // rings: array of {radius (metres), color (css color string), weight (px)}
    function syncRangeRingsOnCesium(position, rings) {
        var viewer = ensureViewer();
        if (!viewer) {
            return;
        }
        clearRangeRingsOnCesium();
        var centre = toCesiumPosition(position);
        if (!centre || !Array.isArray(rings)) {
            return;
        }
        rings.forEach(function(ring, i) {
            var entity = viewer.entities.add({
                id: 'RANGE_RING_' + i,
                position: centre,
                ellipse: {
                    semiMinorAxis: ring.radius,
                    semiMajorAxis: ring.radius,
                    fill: false,
                    outline: true,
                    outlineColor: Cesium.Color.fromCssColorString(ring.color).withAlpha(0.7),
                    outlineWidth: ring.weight || 1,
                    height: 0,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
                }
            });
            cesiumState.rangeRingEntities.push(entity);
        });
    }

    function recenterRangeRingsOnCesium(position) {
        var centre = toCesiumPosition(position);
        if (!centre) {
            return;
        }
        cesiumState.rangeRingEntities.forEach(function(entity) {
            entity.position = centre;
        });
    }

    // Bearing lines (bearings.js) - one polyline entity per bearing id, keyed
    // independently of the balloon/prediction/route entities above.
    function syncBearingLineOnCesium(id, positions, color, weight, opacity) {
        var viewer = ensureViewer();
        if (!viewer) {
            return null;
        }
        var path = toCesiumPositionList(positions);
        if (path.length < 2) {
            return null;
        }
        var entityId = 'BEARING_' + id;
        var entity = viewer.entities.getById(entityId);
        if (!entity) {
            entity = viewer.entities.add({ id: entityId });
        }
        entity.polyline = {
            positions: path,
            clampToGround: false,
            width: weight || 2.5,
            arcType: Cesium.ArcType.GEODESIC,
            material: toCesiumColor(color || '#FFCB05').withAlpha(opacity === undefined ? 1 : opacity)
        };
        entity.show = true;
        cesiumState.bearingLineEntities[id] = entity;
        return entity;
    }

    function removeBearingLineOnCesium(id) {
        var viewer = cesiumState.viewer;
        if (viewer) {
            try { viewer.entities.removeById('BEARING_' + id); } catch (e) { /* ignore */ }
        }
        delete cesiumState.bearingLineEntities[id];
    }

    function syncAllCesiumStateFromStore() {
        if (!cesiumState.active) {
            return;
        }

        var viewer = ensureViewer();
        if (!viewer) {
            return;
        }

        if (typeof balloon_positions !== 'undefined') {
            for (var callsign in balloon_positions) {
                if (!Object.prototype.hasOwnProperty.call(balloon_positions, callsign)) {
                    continue;
                }
                syncBalloonEntity(callsign, {visible: balloon_positions[callsign].visible});
            }
        }

        syncChaseCarEntity();
        syncHomeEntity();
        resizeCesiumViewer();
    }

    function cancelCesiumResize() {
        if (cesiumState.resizeTimer !== null) {
            window.clearTimeout(cesiumState.resizeTimer);
            cesiumState.resizeTimer = null;
        }
    }

    function resizeCesiumViewer() {
        var viewer = cesiumState.viewer;
        if (!viewer || !cesiumState.active) {
            return;
        }

        cancelCesiumResize();

        try {
            if (typeof viewer.resize === 'function') {
                viewer.resize();
            }
        } catch (e) {
            return;
        }

        try {
            if (viewer.scene && typeof viewer.scene.requestRender === 'function') {
                viewer.scene.requestRender();
            }
        } catch (e) {
            // ignore
        }
    }

    function scheduleCesiumResize() {
        var viewer = cesiumState.viewer;
        if (!viewer || !cesiumState.active) {
            return;
        }

        cancelCesiumResize();
        cesiumState.resizeTimer = window.setTimeout(function() {
            cesiumState.resizeTimer = null;
            resizeCesiumViewer();
        }, 100);
    }

    function bindCesiumResizeListener() {
        if (cesiumState.resizeListenerBound || typeof window === 'undefined') {
            return;
        }

        cesiumState.resizeListenerBound = true;
        window.addEventListener('resize', scheduleCesiumResize);
    }

    // Computes the camera position+orientation needed to view `targetPosition`
    // from the given heading/pitch/range offset, with the target landing on
    // `desiredScreenPoint` (defaults to dead-center when omitted/null)
    // instead of always the raw viewport center. Used so a panel-aware
    // fly-to (follow a callsign/position while a side panel is open) can
    // animate directly to its final off-center position in one smooth
    // motion, rather than flying to center and then snapping sideways once
    // the flight completes.
    //
    // Works by temporarily calling camera.lookAt() (an instantaneous, not
    // animated, positioning primitive) to read off exactly where flying to
    // `offset` around the target would land the camera, then restoring the
    // camera to its pre-call state - all synchronously, before any frame
    // renders, so nothing actually visibly jumps. That destination is then
    // nudged in its own screen-plane (right/up) to move the target from
    // center onto the desired screen point, using the frustum's pixel-size
    // math to convert the screen-space delta into a world-space shift.
    function computeCameraDestination(viewer, targetPosition, offset, desiredScreenPoint) {
        var camera = viewer.camera;
        var canvas = viewer.scene && viewer.scene.canvas ? viewer.scene.canvas : null;

        var saved = {
            position: Cesium.Cartesian3.clone(camera.position),
            direction: Cesium.Cartesian3.clone(camera.direction),
            up: Cesium.Cartesian3.clone(camera.up),
            right: Cesium.Cartesian3.clone(camera.right),
            transform: Cesium.Matrix4.clone(camera.transform)
        };

        try {
            camera.lookAt(targetPosition, offset);
            var destPosition = Cesium.Cartesian3.clone(camera.positionWC);
            var result = {
                position: destPosition,
                heading: camera.heading,
                pitch: camera.pitch,
                roll: camera.roll
            };

            if (desiredScreenPoint && canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
                var centerX = canvas.clientWidth / 2;
                var centerY = canvas.clientHeight / 2;
                var dx = desiredScreenPoint.x - centerX;
                var dy = desiredScreenPoint.y - centerY;
                if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
                    var distance = Cesium.Cartesian3.distance(destPosition, targetPosition);
                    if (isFinite(distance) && distance > 0) {
                        var pixelSize = camera.frustum.getPixelDimensions(
                            canvas.clientWidth,
                            canvas.clientHeight,
                            distance,
                            viewer.scene.pixelRatio || 1,
                            new Cesium.Cartesian2()
                        );
                        if (pixelSize && isFinite(pixelSize.x) && isFinite(pixelSize.y)) {
                            var destRight = Cesium.Cartesian3.clone(camera.rightWC);
                            var destUp = Cesium.Cartesian3.clone(camera.upWC);
                            var shifted = Cesium.Cartesian3.clone(destPosition);
                            Cesium.Cartesian3.add(shifted, Cesium.Cartesian3.multiplyByScalar(destRight, -dx * pixelSize.x, new Cesium.Cartesian3()), shifted);
                            Cesium.Cartesian3.add(shifted, Cesium.Cartesian3.multiplyByScalar(destUp, dy * pixelSize.y, new Cesium.Cartesian3()), shifted);
                            result.position = shifted;
                        }
                    }
                }
            }

            return result;
        } catch (e) {
            return null;
        } finally {
            // Restore transform FIRST - position/direction/up/right were
            // captured relative to the original transform, so reassigning
            // them while camera.transform is still lookAt()'s temporary
            // matrix would reinterpret those saved vectors in the wrong
            // frame and leave the camera somewhere completely wrong.
            camera.transform = saved.transform;
            camera.position = saved.position;
            camera.direction = saved.direction;
            camera.up = saved.up;
            camera.right = saved.right;
        }
    }

    // Animates the camera directly from wherever it currently is to
    // destPosition/destOrientation over `duration` seconds, via a plain
    // position+angle lerp - not Cesium's built-in flyTo/flyToBoundingSphere
    // tween. Cesium's own flyTo auto-inserts a "rise up, arc over, descend"
    // detour for any reasonably long flight (CameraFlightPathFactory boosts
    // altitude mid-flight so the camera doesn't appear to clip through the
    // ground), which reads as "zoom all the way out, then back in" for what's
    // meant to be a same-altitude pan to re-center on something. This moves
    // laterally and adjusts zoom together, directly, with no such detour.
    var cesiumCameraAnimationToken = 0;

    function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function animateCameraTo(viewer, destPosition, destOrientation, duration) {
        var camera = viewer.camera;
        var token = ++cesiumCameraAnimationToken;

        if (!duration || duration <= 0) {
            // endTransform: IDENTITY is required here - destPosition is a
            // world-frame Cartesian3 (from computeCameraDestination's
            // camera.positionWC), but setView's `destination` is otherwise
            // applied relative to whatever camera.transform currently is
            // (which this app leaves non-identity at times), silently
            // reinterpreting a correct world position into a wildly wrong
            // one (e.g. landing camera below the earth's surface).
            camera.setView({destination: destPosition, orientation: destOrientation, endTransform: Cesium.Matrix4.IDENTITY});
            if (typeof viewer.scene.requestRender === 'function') {
                viewer.scene.requestRender();
            }
            return;
        }

        var startPosition = Cesium.Cartesian3.clone(camera.positionWC);
        var startHeading = camera.heading;
        var startPitch = camera.pitch;
        var startRoll = camera.roll;
        var headingDelta = Cesium.Math.negativePiToPi(destOrientation.heading - startHeading);
        var rollDelta = Cesium.Math.negativePiToPi((destOrientation.roll || 0) - startRoll);
        var durationMs = duration * 1000;
        var startTime = null;
        var scratchPosition = new Cesium.Cartesian3();

        function step(now) {
            if (token !== cesiumCameraAnimationToken) {
                return; // superseded by a newer animation
            }
            if (startTime === null) {
                startTime = now;
            }
            var t = Math.min(1, (now - startTime) / durationMs);
            var e = easeInOutCubic(t);

            Cesium.Cartesian3.lerp(startPosition, destPosition, e, scratchPosition);
            camera.setView({
                destination: scratchPosition,
                orientation: {
                    heading: startHeading + headingDelta * e,
                    pitch: Cesium.Math.lerp(startPitch, destOrientation.pitch, e),
                    roll: startRoll + rollDelta * e
                },
                // See the duration<=0 branch's comment - scratchPosition is
                // also always a world-frame Cartesian3.
                endTransform: Cesium.Matrix4.IDENTITY
            });

            if (t < 1) {
                requestAnimationFrame(step);
            }
        }

        requestAnimationFrame(step);
    }

    function flyCesiumToPosition(latlng, panOptions) {
        var viewer = ensureViewer();
        if (!viewer) {
            return;
        }

            bindCesiumResizeListener();
        var normalized = toCesiumPoint(latlng);
        if (!normalized) {
            return;
        }

        var options = panOptions || {};
        var duration = typeof options.duration === 'number' ? options.duration : 1.4;

        cesiumState.camera.focus = {
            type: 'position',
            position: normalized
        };

        var range = clampNumber(options.range, 1000, 50000, Math.max((normalized[2] || 0) * 2.5, cesiumState.camera.range));
        cesiumState.camera.range = range;

        var targetPosition = Cesium.Cartesian3.fromDegrees(normalized[1], normalized[0], normalized[2] || 0);
        var offset = getCameraOffset({
            heading: options.heading,
            pitch: options.pitch,
            range: range
        });

        // alignToFollowViewport (opted into by panMapToVisibleCenter, this
        // function's "user pans/focuses somewhere" caller; passive
        // camera-state refreshes from refocusCesiumCamera don't, to avoid
        // re-nudging the camera on every minor heading/pitch/range tweak)
        // lands the target on whatever's actually visible (i.e. not covered
        // by an open side panel/DOA card) instead of the raw viewport
        // center. computeCameraDestination() folds that offset into the
        // flight's actual destination up front, so the camera animates
        // directly there in one motion instead of flying to center and
        // snapping sideways once the flight completes.
        var anchor = (options.alignToFollowViewport === true && typeof getFollowViewportAnchorPoint === 'function') ? getFollowViewportAnchorPoint() : null;
        var dest = computeCameraDestination(viewer, targetPosition, offset, anchor);

        if (dest) {
            animateCameraTo(viewer, dest.position, {heading: dest.heading, pitch: dest.pitch, roll: dest.roll}, duration);
        } else {
            viewer.camera.flyToBoundingSphere(
                new Cesium.BoundingSphere(targetPosition, 10.0),
                {duration: duration, offset: offset}
            );
        }

        if (typeof viewer.scene.requestRender === 'function') {
            viewer.scene.requestRender();
        }
    }

    function getFollowViewportAnchorPoint() {
        var width = window.innerWidth || document.documentElement.clientWidth || 0;
        var height = window.innerHeight || document.documentElement.clientHeight || 0;
        if (width <= 0 || height <= 0) {
            return null;
        }

        // Nav/panels are no longer one bottom-left "dock" — the APRS/Settings
        // panel hangs top-left or top-right below the top bar, and the Log
        // panel spans the bottom. Bias the follow anchor away from whichever
        // panel is actually open (index.html's getOpenDockPanel()), instead
        // of assuming a fixed dock position.
        var panel = (typeof window.getOpenDockPanel === 'function') ? window.getOpenDockPanel() : null;
        if (!panel) {
            return {x: width / 2, y: height / 2};
        }

        var rect = panel.getBoundingClientRect();
        if (!rect) {
            return {x: width / 2, y: height / 2};
        }

        if (panel.id === 'logPanel') {
            var bottomEdge = Math.min(Math.max(rect.top, 0), height);
            return {x: width / 2, y: bottomEdge / 2};
        }

        var onLeft = rect.left < (width / 2);
        if (onLeft) {
            var rightEdge = Math.min(Math.max(rect.right, 0), width);
            return {x: (rightEdge + width) / 2, y: height / 2};
        }
        var leftEdge = Math.min(Math.max(rect.left, 0), width);
        return {x: leftEdge / 2, y: height / 2};
    }

    function focusCesiumOnCallsign(callsign, panOptions) {
        var viewer = ensureViewer();
        if (!viewer) {
            return false;
        }

        var csKey = (callsign || '').toString().toUpperCase();
        if (!csKey) {
            return false;
        }

        var entity = viewer.entities.getById(csKey + ':track');
        if (!entity) {
            return false;
        }

        var latest = null;
        if (typeof balloon_positions !== 'undefined' && balloon_positions.hasOwnProperty(csKey) && balloon_positions[csKey] && balloon_positions[csKey].latest_data) {
            latest = balloon_positions[csKey].latest_data;
        }

        var alt = latest && latest.position && latest.position.length > 2 ? parseFloat(latest.position[2]) || 0 : 0;
        cesiumState.camera.focus = {
            type: 'callsign',
            callsign: csKey
        };

        var range = clampNumber(panOptions && panOptions.range, 1000, 50000, Math.max(alt * 2.5, cesiumState.camera.range));
        cesiumState.camera.range = range;

        var duration = panOptions && typeof panOptions.duration === 'number' ? panOptions.duration : 1.4;
        var offset = getCameraOffset({
            heading: panOptions && panOptions.heading,
            pitch: panOptions && panOptions.pitch,
            range: range
        });
        var targetPosition = entity.position && entity.position.getValue ? entity.position.getValue(Cesium.JulianDate.now()) : null;

        // See flyCesiumToPosition()'s matching comment: computeCameraDestination()
        // folds the alignToFollowViewport offset into the flight's actual
        // destination up front, so the camera animates directly there in one
        // motion instead of flying to center and snapping sideways afterward.
        var anchor = (panOptions && panOptions.alignToFollowViewport === true && typeof getFollowViewportAnchorPoint === 'function') ? getFollowViewportAnchorPoint() : null;
        var dest = targetPosition ? computeCameraDestination(viewer, targetPosition, offset, anchor) : null;

        if (dest) {
            animateCameraTo(viewer, dest.position, {heading: dest.heading, pitch: dest.pitch, roll: dest.roll}, duration);
        } else {
            viewer.flyTo(entity, {duration: duration, offset: offset});
        }

        if (typeof viewer.scene.requestRender === 'function') {
            viewer.scene.requestRender();
        }
        return true;
    }

    function refocusCesiumCamera() {
        if (!cesiumState.active || !cesiumState.camera.focus) {
            return;
        }

        if (cesiumState.camera.focus.type === 'callsign') {
            focusCesiumOnCallsign(cesiumState.camera.focus.callsign, {duration: 0.2});
        } else if (cesiumState.camera.focus.type === 'position') {
            flyCesiumToPosition(cesiumState.camera.focus.position, {duration: 0.2});
        }
    }

    function setCesiumCameraState(nextState) {
        applyCameraState(nextState);
        if (cesiumState.active) {
            refocusCesiumCamera();
        }
        return {
            heading: cesiumState.camera.heading,
            pitch: cesiumState.camera.pitch,
            range: cesiumState.camera.range
        };
    }

    function getCesiumCameraState() {
        return {
            heading: cesiumState.camera.heading,
            pitch: cesiumState.camera.pitch,
            range: cesiumState.camera.range
        };
    }

    var leafletControlsState = {
        savedParent: null,
        savedPlaceholder: null,
        savedStyles: null
    };

    function moveLeafletControlsToBody() {
        try {
            var container = document.querySelector('.leaflet-control-container');
            if (!container || container.getAttribute('data-moved') === '1') {
                return;  // Already moved or doesn't exist
            }

            // Save original parent and position
            leafletControlsState.savedParent = container.parentNode;
            leafletControlsState.savedPlaceholder = document.createComment('leaflet-control-container placeholder');

            // Save all inline styles to restore them later
            leafletControlsState.savedStyles = container.getAttribute('style') || '';

            // Insert placeholder where the container was
            leafletControlsState.savedParent.insertBefore(leafletControlsState.savedPlaceholder, container);

            // .leaflet-control-container has no in-flow content of its own (its
            // .leaflet-top/.leaflet-bottom children are all position:absolute), so
            // its getBoundingClientRect() is always 0x0 - freezing width/height to
            // that snapshot collapsed the containing block for any left-anchored
            // control (e.g. the routing/directions panel), even though right-anchored
            // ones happened to still render. Span the viewport instead and rely on
            // Leaflet's own pointer-events model (.leaflet-top/.leaflet-bottom: none,
            // .leaflet-control: auto) so empty space still passes clicks through to
            // the map underneath.
            container.style.position = 'fixed';
            container.style.top = '0px';
            container.style.left = '0px';
            container.style.width = '100%';
            container.style.height = '100%';
            container.style.zIndex = '2147483647';
            container.style.pointerEvents = 'none';
            container.setAttribute('data-moved', '1');

            // Append to document.body
            document.body.appendChild(container);
        } catch (e) {
            console.warn('Failed to move Leaflet controls:', e);
        }
    }

    function restoreLeafletControls() {
        try {
            var container = document.querySelector('.leaflet-control-container');
            if (!container || container.getAttribute('data-moved') !== '1') {
                return;  // Not moved or already restored
            }

            // Remove the container from body
            if (container.parentNode === document.body) {
                document.body.removeChild(container);
            }

            // Restore to original parent using placeholder
            if (leafletControlsState.savedParent && leafletControlsState.savedPlaceholder) {
                leafletControlsState.savedParent.insertBefore(container, leafletControlsState.savedPlaceholder);
                leafletControlsState.savedParent.removeChild(leafletControlsState.savedPlaceholder);
            }

            // Restore original inline styles
            if (leafletControlsState.savedStyles) {
                container.setAttribute('style', leafletControlsState.savedStyles);
            } else {
                container.removeAttribute('style');
            }
            container.removeAttribute('data-moved');

            leafletControlsState.savedParent = null;
            leafletControlsState.savedPlaceholder = null;
            leafletControlsState.savedStyles = null;
        } catch (e) {
            console.warn('Failed to restore Leaflet controls:', e);
        }
    }

    function applyCesiumMapViewState(active) {
        var next = !!active;
        cesiumState.active = next;

        if (!hasCesium()) {
            return;
        }

        var cesiumContainer = getCesiumContainer();
        if (!cesiumContainer) {
            return;
        }

        if (next) {
            // Enable 3D view: move controls and set cesium-active class
            moveLeafletControlsToBody();
            cesiumContainer.classList.add('cesium-active');

            var viewer = ensureViewer();
            setContainerVisible(true);
            if (viewer) {
                resizeCesiumViewer();
                syncCameraStateFromViewer();
                syncAllCesiumStateFromStore();
                try {
                    if (typeof chase_config !== 'undefined' && chase_config && isFinite(parseFloat(chase_config.default_lat)) && isFinite(parseFloat(chase_config.default_lon))) {
                        flyCesiumToPosition([
                            parseFloat(chase_config.default_lat),
                            parseFloat(chase_config.default_lon),
                            isFinite(parseFloat(chase_config.default_alt)) ? parseFloat(chase_config.default_alt) : 0
                        ], {duration: 1.2});
                    }
                } catch (e) {
                    // ignore
                }
                refocusCesiumCamera();
                try {
                    viewer.scene.requestRender();
                } catch (e) {
                    // ignore
                }
            }
        } else {
            // Disable 3D view: restore controls and remove cesium-active class
            restoreLeafletControls();
            cesiumContainer.classList.remove('cesium-active');
            hideCesiumCameraSlider();

            setContainerVisible(false);
            if (typeof map !== 'undefined' && map && typeof map.invalidateSize === 'function') {
                window.setTimeout(function() {
                    try {
                        map.invalidateSize({debounceMoveend: true});
                    } catch (e) {
                        // ignore
                    }
                }, 0);
            }
        }
    }

    function isCesiumActive() {
        return !!cesiumState.active;
    }

    function syncCesiumAfterBalloonUpdate(callsign, payload) {
        if (!cesiumState.active) {
            return;
        }
        syncBalloonEntity(callsign, payload || {});
    }

    function syncCesiumAfterPredictionUpdate(callsign, payload) {
        if (!cesiumState.active) {
            return;
        }
        syncBalloonEntity(callsign, payload || {});
    }

    function syncCesiumAfterCarUpdate() {
        if (!cesiumState.active) {
            return;
        }
        syncChaseCarEntity();
    }

    function syncCesiumAfterOtherCarUpdate(key, name, vehicle) {
        if (!cesiumState.active) {
            return;
        }
        syncOtherChaserEntity(key, name, vehicle);
    }

    window.isCesiumActive = isCesiumActive;
    window.syncAllCesiumStateFromStore = syncAllCesiumStateFromStore;
    window.applyCesiumMapViewState = applyCesiumMapViewState;
    window.getCesiumMapModes = getCesiumMapModes;
    window.applyCesiumMapMode = applyCesiumMapMode;
    window.flyCesiumToPosition = flyCesiumToPosition;
    window.focusCesiumOnCallsign = focusCesiumOnCallsign;
    window.setCesiumCameraState = setCesiumCameraState;
    window.getCesiumCameraState = getCesiumCameraState;
    window.setCesiumCameraPitch = setCesiumCameraPitch;
    window.showCesiumCameraSlider = showCesiumCameraSlider;
    window.hideCesiumCameraSlider = hideCesiumCameraSlider;
    window.refocusCesiumCamera = refocusCesiumCamera;
    window.syncCesiumAfterBalloonUpdate = syncCesiumAfterBalloonUpdate;
    window.syncCesiumAfterPredictionUpdate = syncCesiumAfterPredictionUpdate;
    window.syncCesiumAfterCarUpdate = syncCesiumAfterCarUpdate;
    window.syncCesiumAfterOtherCarUpdate = syncCesiumAfterOtherCarUpdate;
    window.showChaseRouteOnCesium = showChaseRouteOnCesium;
    window.clearChaseRouteOnCesium = clearChaseRouteOnCesium;
    window.zoomCesiumViewIn = zoomCesiumViewIn;
    window.zoomCesiumViewOut = zoomCesiumViewOut;
    window.set2DMode = set2DMode;
    window.set3DMode = set3DMode;
    window.get2DMode = get2DMode;
    window.toggle2D3DMode = toggle2D3DMode;
    window.toggleCesiumMeasureMode = toggleCesiumMeasureMode;
    window.clearCesiumMeasureLine = clearCesiumMeasureLine;
    window.getCesiumViewer = getCesiumViewer;
    window.getCesiumMeasurePanel = getCesiumMeasurePanel;
    window.removeOtherChaserEntity = removeOtherChaserEntity;
    window.clearChaseCarOnCesium = clearChaseCarOnCesium;
    window.syncRangeRingsOnCesium = syncRangeRingsOnCesium;
    window.clearRangeRingsOnCesium = clearRangeRingsOnCesium;
    window.recenterRangeRingsOnCesium = recenterRangeRingsOnCesium;
    window.syncBearingLineOnCesium = syncBearingLineOnCesium;
    window.removeBearingLineOnCesium = removeBearingLineOnCesium;
    window.syncUserLocationOnCesium = syncUserLocationOnCesium;
})();
