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
        mapMode: 'standard',
        mapModeApplySeq: 0,
        buildingsTileset: null,
        camera: {
            heading: 0,
            pitch: -35,
            range: 7500,
            focus: null
        },
        balloonEntities: {},
        predictionEntities: {},
        chaseCarEntity: null,
        homeEntity: null
    };

    var CESIUM_CAMERA_STORAGE_KEY = 'chasemapper_cesium_camera';
    var CESIUM_MAP_MODE_STORAGE_KEY = 'chasemapper_cesium_map_mode';
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
            {id: 'buildings', label: 'Satellite + Terrain + 3D Buildings'}
        ];

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
            return new Cesium.ArcGisMapServerImageryProvider({
                url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
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

    function toCesiumPositionList(points, options) {
        var listOptions = options || {};
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
            return;
        }

        try {
            viewer.scene.primitives.remove(cesiumState.buildingsTileset);
        } catch (e) {
            // ignore remove failures
        }
        cesiumState.buildingsTileset = null;
    }

    function getTerrainProviderPromise(modeId) {
        if (!modeUsesTerrain(modeId)) {
            return Promise.resolve(new Cesium.EllipsoidTerrainProvider());
        }

        try {
            if (typeof Cesium.createWorldTerrainAsync === 'function') {
                return Cesium.createWorldTerrainAsync();
            }
            if (typeof Cesium.createWorldTerrain === 'function') {
                return Promise.resolve(Cesium.createWorldTerrain());
            }
        } catch (e) {
            console.warn('Unable to initialize world terrain, falling back to ellipsoid terrain.', e);
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
            viewer.imageryLayers.removeAll();
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
            } catch (terrainErr) {
                console.warn('Failed to apply terrain provider, reverting to ellipsoid terrain.', terrainErr);
                viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
            }

            clearBuildingsTileset();

            if (modeUsesBuildings(normalized)) {
                try {
                    if (typeof Cesium.createOsmBuildingsAsync === 'function') {
                        Cesium.createOsmBuildingsAsync().then(function(tileset) {
                            if (!cesiumState.viewer || applySeq !== cesiumState.mapModeApplySeq || !tileset) {
                                return;
                            }
                            cesiumState.buildingsTileset = tileset;
                            viewer.scene.primitives.add(tileset);
                            if (typeof viewer.scene.requestRender === 'function') {
                                viewer.scene.requestRender();
                            }
                        }).catch(function(tilesErr) {
                            console.warn('Unable to load 3D buildings tileset for mode ' + normalized + '.', tilesErr);
                        });
                    }
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
        viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
        viewer.scene.screenSpaceCameraController.maximumTiltAngle = Math.PI / 2;
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

        if (mapContainer) {
            mapContainer.style.display = '';
            mapContainer.setAttribute('aria-hidden', 'false');
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

        var path = toCesiumPositionList((payload && payload.pathData) || (balloonState && balloonState.path && typeof balloonState.path.getLatLngs === 'function' ? balloonState.path.getLatLngs() : []), {maxSegmentMeters: 15000});
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

        var predPath = toCesiumPositionList((payload && payload.predPathData) || (balloonState && balloonState.pred_path && typeof balloonState.pred_path.getLatLngs === 'function' ? balloonState.pred_path.getLatLngs() : []), {maxSegmentMeters: 12000});
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

        var predLanding = toCesiumPosition((payload && payload.predLandingData) || (balloonState && balloonState.pred_marker && balloonState.pred_marker.getLatLng ? balloonState.pred_marker.getLatLng() : null));
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

        var burst = toCesiumPosition((payload && payload.burstData) || (balloonState && balloonState.burst_marker && balloonState.burst_marker.getLatLng ? balloonState.burst_marker.getLatLng() : null));
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

        var abortPath = toCesiumPositionList((payload && payload.abortPathData) || (balloonState && balloonState.abort_path && typeof balloonState.abort_path.getLatLngs === 'function' ? balloonState.abort_path.getLatLngs() : []), {maxSegmentMeters: 12000});
        upsertBalloonEntity(callsign, 'abort-path', {
            show: visible && abortPath.length >= 2,
            polyline: {
                positions: abortPath,
                clampToGround: false,
                width: 2,
                arcType: Cesium.ArcType.GEODESIC,
                material: Cesium.Color.RED.withAlpha(0.6)  // Matched Leaflet opacity of 0.6
            }
        });

        var abortLanding = toCesiumPosition((payload && payload.abortLandingData) || (balloonState && balloonState.abort_marker && balloonState.abort_marker.getLatLng ? balloonState.abort_marker.getLatLng() : null));
        upsertBalloonEntity(callsign, 'abort', {
            show: visible && !!abortLanding,
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
        if (!viewer || !cesiumState.active || typeof chase_car_position === 'undefined' || !chase_car_position || !Array.isArray(chase_car_position.latest_data) || chase_car_position.latest_data.length < 2) {
            return;
        }

        var carPosition = toCesiumPosition(chase_car_position.latest_data);
        if (!carPosition) {
            return;
        }

        var pathPoints = toCesiumPositionList(chase_car_position.path && typeof chase_car_position.path.getLatLngs === 'function' ? chase_car_position.path.getLatLngs() : [chase_car_position.latest_data], {maxSegmentMeters: 10000});
        if (pathPoints.length === 0) {
            pathPoints = [carPosition];
        }

        cesiumState.chaseCarEntity = upsertBalloonEntity('CHASE_CAR', 'track', {
            show: true,
            position: carPosition,
            billboard: {
                image: '/static/img/car-blue.png',
                width: 55,
                height: 25,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            polyline: {
                positions: pathPoints,
                clampToGround: false,
                width: 2,
                arcType: Cesium.ArcType.GEODESIC,
                material: Cesium.Color.BLACK
            }
        });
    }

    function syncHomeEntity() {
        var viewer = cesiumState.viewer;
        if (!viewer || !cesiumState.active || typeof chase_config === 'undefined' || !chase_config) {
            return;
        }

        var selectedProfile = (chase_config.selected_profile || '').toString();
        var isStationProfile = false;
        try {
            if (selectedProfile && chase_config.profiles && chase_config.profiles[selectedProfile]) {
                isStationProfile = chase_config.profiles[selectedProfile].car_source_type === 'station';
            }
        } catch (e) {
            isStationProfile = false;
        }

        if (!isStationProfile) {
            if (cesiumState.homeEntity) {
                cesiumState.homeEntity.show = false;
            }
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
            billboard: {
                image: '/static/img/antenna-green.png',
                width: 26,
                height: 34,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                text: 'Receiver Location',
                font: '600 12px "Segoe UI", sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.TOP,
                pixelOffset: new Cesium.Cartesian2(0, 10),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
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

        if (typeof viewer.resize === 'function') {
            viewer.resize();
        }
    }

    function flyCesiumToPosition(latlng, panOptions) {
        var viewer = ensureViewer();
        if (!viewer) {
            return;
        }

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

        viewer.camera.flyToBoundingSphere(
            new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(normalized[1], normalized[0], normalized[2] || 0), 10.0),
            {
                duration: duration,
                offset: getCameraOffset({
                    heading: options.heading,
                    pitch: options.pitch,
                    range: range
                })
            }
        );

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

        var dock = document.getElementById('menuDock');
        if (!dock) {
            return {x: width / 2, y: height / 2};
        }

        var rect = dock.getBoundingClientRect();
        if (!rect || !isFinite(rect.right)) {
            return {x: width / 2, y: height / 2};
        }

        var rightEdge = Math.min(Math.max(rect.right, 0), width);
        return {
            x: (rightEdge + width) / 2,
            y: height / 2
        };
    }

    function alignTargetToScreenPoint(targetPosition, desiredPoint) {
        var viewer = cesiumState.viewer;
        if (!viewer || !targetPosition || !desiredPoint) {
            return;
        }

        var canvas = viewer.scene && viewer.scene.canvas ? viewer.scene.canvas : null;
        if (!canvas || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) {
            return;
        }

        for (var i = 0; i < 3; i++) {
            var windowPos = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, targetPosition);
            if (!windowPos) {
                return;
            }

            var dx = desiredPoint.x - windowPos.x;
            var dy = desiredPoint.y - windowPos.y;
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
                break;
            }

            var distance = Cesium.Cartesian3.distance(viewer.camera.positionWC, targetPosition);
            if (!isFinite(distance) || distance <= 0) {
                break;
            }

            var pixelSize = viewer.camera.frustum.getPixelDimensions(
                canvas.clientWidth,
                canvas.clientHeight,
                distance,
                viewer.scene.pixelRatio || 1,
                new Cesium.Cartesian2()
            );

            if (!pixelSize || !isFinite(pixelSize.x) || !isFinite(pixelSize.y)) {
                break;
            }

            // Shift camera in view-plane so target appears at desired screen anchor.
            viewer.camera.move(viewer.camera.right, -dx * pixelSize.x);
            viewer.camera.move(viewer.camera.up, dy * pixelSize.y);
        }

        if (typeof viewer.scene.requestRender === 'function') {
            viewer.scene.requestRender();
        }
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

        viewer.flyTo(entity, {
            duration: panOptions && typeof panOptions.duration === 'number' ? panOptions.duration : 1.4,
            offset: getCameraOffset({
                heading: panOptions && panOptions.heading,
                pitch: panOptions && panOptions.pitch,
                range: range
            }),
            complete: function() {
                if (panOptions && panOptions.alignToFollowViewport === true) {
                    var desiredAnchor = getFollowViewportAnchorPoint();
                    alignTargetToScreenPoint(entity.position && entity.position.getValue ? entity.position.getValue(Cesium.JulianDate.now()) : null, desiredAnchor);
                }
            }
        });

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

            // Compute fixed position relative to viewport
            var rect = container.getBoundingClientRect();
            container.style.position = 'fixed';
            container.style.top = rect.top + 'px';
            container.style.left = rect.left + 'px';
            container.style.width = rect.width + 'px';
            container.style.height = rect.height + 'px';
            container.style.zIndex = '2147483647';
            container.style.pointerEvents = 'auto';
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
                if (typeof viewer.resize === 'function') {
                    viewer.resize();
                }
                syncCameraStateFromViewer();
                syncAllCesiumStateFromStore();
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
})();
