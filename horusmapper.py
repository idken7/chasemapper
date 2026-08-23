#!/usr/bin/env python2.7
#
#   Project Horus - Browser-Based Chase Mapper
#
#   Copyright (C) 2018  Mark Jessop <vk5qi@rfhead.net>
#   Released under GNU GPL v3 or later
#
import sys

# Version check.
if sys.version_info < (3, 6):
    print("CRITICAL - chasemapper requires Python 3.6 or newer!")
    sys.exit(1)

import json
import logging
import flask
from flask_socketio import SocketIO
from socketio.exceptions import ConnectionRefusedError
import os.path
import math
import ipaddress
import pytz
import time
import traceback
from threading import Thread, Lock, Event
from collections import deque
from datetime import datetime, timedelta, timezone
from dateutil.parser import parse
import os
import secrets

# Ensure application logs (INFO+) are sent to stdout so container logs show APRS activity
import logging as _logging
_logging.basicConfig(format='%(asctime)s %(levelname)s:%(message)s', level=_logging.INFO)

from chasemapper import __version__ as CHASEMAPPER_VERSION
from chasemapper.config import *
from chasemapper.earthmaths import *
from chasemapper.geometry import *
from chasemapper.gps import SerialGPS
from chasemapper.gpsd import GPSDAdaptor
from chasemapper.atmosphere import time_to_landing
from chasemapper.listeners import OziListener, UDPListener, fix_datetime
from chasemapper.predictor import predictor_spawn_download, model_download_running, get_wind_profile
from chasemapper.habitat import (
    HabitatChaseUploader,
    initListenerCallsign,
    uploadListenerPosition,
)
from chasemapper.sondehub import SondehubChaseUploader
from chasemapper.logger import ChaseLogger
from chasemapper.logread import read_last_balloon_telemetry
from chasemapper.bearings import Bearings
from chasemapper.tawhiri import get_tawhiri_prediction
from chasemapper.aprs_tracker import APRSTracker
import requests
from dateutil.parser import parse as parse_dt


# Define Flask Application, and allow automatic reloading of templates for dev work
app = flask.Flask(__name__)
# Flask/SocketIO session signing key. Prefer an explicit value from the
# environment (CHASEMAPPER_SECRET_KEY) so it can be pinned across restarts for a
# deployment; otherwise fall back to a random per-process key rather than a
# hard-coded, publicly-known value.
app.config["SECRET_KEY"] = os.environ.get("CHASEMAPPER_SECRET_KEY", "").strip() or secrets.token_hex(32)
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.jinja_env.auto_reload = True

# SocketIO instance
socketio = SocketIO(app)

# Store the last computed chase route (GeoJSON) on the server for the desktop web
# client and any legacy caller that doesn't identify itself with a client_id (see
# client_routes below for the per-client equivalent used by mobile clients).
latest_route_geojson = None
latest_route_lock = Lock()
latest_route_meta = {
    "distance_m": None,
    "duration_s": None,
    "provider": None,
    "provider_base": None,
    "updated_at": None,
    "steps": None,
}

# Per-client computed routes, keyed by the mobile app's persisted client_id (see
# mobile/src/location/clientIdentity.ts). Each mobile chaser has their own start
# position and their own followed target, so their route has to be computed and
# stored independently — folding it into the single latest_route_geojson/
# latest_route_meta globals above meant every mobile client's /api/mobile_state
# poll returned whichever client's /api/route call happened to land last,
# regardless of who asked for it or where they actually were. Mirrors
# client_car_tracks' per-client_id dict + lock pattern.
client_routes = {}
client_routes_lock = Lock()

# API security/rate-limit state for internet-exposed route/state endpoints.
api_rate_limit_lock = Lock()
api_rate_limit_buckets = {}
# Every distinct (client_ip, bucket_name) pair ever seen gets its own entry
# above, which otherwise never gets cleaned up. Periodically sweep out buckets
# that have gone quiet so a long-running server doesn't accumulate one forever
# per visitor. Counter/threshold are only ever touched under api_rate_limit_lock.
_rate_limit_calls_since_sweep = 0
_RATE_LIMIT_SWEEP_INTERVAL = 500
# A bucket's deque always ends non-empty after _consume_rate_limit touches it
# (the trim step is immediately followed by either an append or a refusal
# that leaves >=1 entry) - so "is this bucket empty" never actually happens
# and can't be used to detect an abandoned one. Instead, treat a bucket whose
# *most recent* recorded request is older than this as abandoned, regardless
# of its own (possibly much shorter) configured window.
_RATE_LIMIT_BUCKET_STALE_S = 3600


def _bool_from_env(value, default=False):
    if value is None:
        return default
    text = str(value).strip().lower()
    if text in ("1", "true", "yes", "on"):
        return True
    if text in ("0", "false", "no", "off"):
        return False
    return default


def _int_from_env(value, default_value):
    try:
        parsed = int(value)
        return parsed if parsed > 0 else default_value
    except Exception:
        return default_value


def _trust_proxy_headers():
    # Only honour X-Forwarded-For when explicitly enabled (i.e. the server is
    # actually behind a trusted reverse proxy). Otherwise a client can spoof the
    # header to appear on a private network (bypassing auth) or to evade the
    # per-IP rate limiter.
    return str(os.environ.get("CHASEMAPPER_TRUST_PROXY", "")).strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def _get_client_ip():
    # Prefer the proxy-forwarded source only when proxy headers are trusted.
    if _trust_proxy_headers():
        fwd = flask.request.headers.get("X-Forwarded-For", "")
        if fwd:
            return fwd.split(",")[0].strip()
    return (flask.request.remote_addr or "").strip()


def _is_private_ip(ip_text):
    try:
        ip_obj = ipaddress.ip_address(ip_text)
        return bool(ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local)
    except Exception:
        # Unknown/invalid addresses are treated as non-private.
        return False


def _get_configured_api_key():
    # Environment variable has precedence; config fallback for deployments that
    # prefer file-based settings.
    env_key = os.environ.get("CHASEMAPPER_API_KEY", "").strip()
    if env_key:
        return env_key

    try:
        cfg_key = str(chasemapper_config.get("api_access_key", "")).strip()
    except Exception:
        cfg_key = ""
    return cfg_key


def _auth_mode():
    # auto: require auth only for non-private IPs when key is configured.
    # true: require auth for all route/state endpoint requests.
    # false: disable API-key checks.
    return str(os.environ.get("CHASEMAPPER_REQUIRE_API_AUTH", "auto")).strip().lower()


def _require_api_auth_for_request(client_ip, api_key):
    mode = _auth_mode()
    if mode in ("false", "0", "no", "off"):
        return False
    if mode in ("true", "1", "yes", "on"):
        return bool(api_key)
    # auto mode
    if not api_key:
        return False
    return not _is_private_ip(client_ip)


def _request_api_key():
    # Header-first, query fallback.
    header_key = (flask.request.headers.get("X-API-Key", "") or "").strip()
    if header_key:
        return header_key
    query_key = (flask.request.args.get("api_key", "") or "").strip()
    return query_key


def _rate_limit_config_for_endpoint(path, method):
    # Route computation is more expensive than state reads.
    if path == "/api/route" and method == "POST":
        default_limit = 60
    elif path == "/api/latest_route":
        default_limit = 240
    elif path == "/api/mobile_state" and method == "GET":
        default_limit = 120
    else:
        default_limit = 120

    limit = _int_from_env(os.environ.get("CHASEMAPPER_API_RATE_LIMIT_PER_MIN"), default_limit)
    window_s = _int_from_env(os.environ.get("CHASEMAPPER_API_RATE_LIMIT_WINDOW_S"), 60)
    enabled = _bool_from_env(os.environ.get("CHASEMAPPER_API_RATE_LIMIT_ENABLED", "true"), default=True)
    return enabled, limit, window_s


def _consume_rate_limit(client_ip, bucket_name, limit, window_s):
    global _rate_limit_calls_since_sweep
    now = time.time()
    bucket_key = f"{client_ip}:{bucket_name}"

    with api_rate_limit_lock:
        dq = api_rate_limit_buckets.get(bucket_key)
        if dq is None:
            dq = deque()
            api_rate_limit_buckets[bucket_key] = dq

        # Drop entries outside window.
        cutoff = now - float(window_s)
        while dq and dq[0] <= cutoff:
            dq.popleft()

        if len(dq) >= limit:
            retry_after = int(max(1, math.ceil((dq[0] + window_s) - now)))
            result = (False, retry_after)
        else:
            dq.append(now)
            result = (True, 0)

        _rate_limit_calls_since_sweep += 1
        if _rate_limit_calls_since_sweep >= _RATE_LIMIT_SWEEP_INTERVAL:
            _rate_limit_calls_since_sweep = 0
            _stale_cutoff = now - _RATE_LIMIT_BUCKET_STALE_S
            for _key in [k for k, v in api_rate_limit_buckets.items() if not v or v[-1] <= _stale_cutoff]:
                del api_rate_limit_buckets[_key]

        return result


#
# Socket.IO security: connection-time auth, per-action "operator" auth for
# destructive shared actions, and rate limiting - all reusing the exact same
# CHASEMAPPER_API_KEY / CHASEMAPPER_REQUIRE_API_AUTH policy as the REST API
# above, so there's a single, consistent story for "who can do what".
#
# Flask-SocketIO (in the default threading async mode this app runs under)
# preserves the original handshake's Flask request context for the lifetime
# of a connection, so flask.request.args/headers inside a `connect` handler
# *or* any later event handler on that same connection both see the query
# string / headers the client connected with. That means the API key only
# needs to be supplied once, at connect time (as an `api_key` query param,
# same as the REST endpoints accept), not repeated on every event.
#


def _require_socketio_connect_auth():
    """Whether the current Socket.IO connection attempt must present a valid API key."""
    if _testing_mode():
        return False
    return _require_api_auth_for_request(_get_client_ip(), _get_configured_api_key())


def _require_operator_auth():
    """Gate destructive/shared actions (clearing payload or car data) behind
    the same API-key policy used to guard the connection and the REST API.

    This is deliberately re-checked per-action (not just once at connect)
    so that a key configured/rotated after a client connects still applies
    to long-lived Socket.IO sessions without requiring a reconnect.
    """
    if _testing_mode():
        return True
    configured_key = _get_configured_api_key()
    if not _require_api_auth_for_request(_get_client_ip(), configured_key):
        return True
    return _request_api_key() == configured_key


def _deny_operator_action(action_name):
    logging.warning(
        "Denied '%s' from %s: missing/invalid API key.", action_name, _get_client_ip()
    )
    try:
        socketio.emit(
            "operator_action_denied",
            {"action": action_name, "reason": "unauthorized"},
            namespace="/chasemapper",
            room=flask.request.sid,
        )
    except Exception:
        logging.exception("Error notifying client of denied operator action")


def _device_position_rate_limit_config():
    enabled = _bool_from_env(
        os.environ.get("CHASEMAPPER_SOCKETIO_RATE_LIMIT_ENABLED", "true"), default=True
    )
    limit = _int_from_env(os.environ.get("CHASEMAPPER_SOCKETIO_RATE_LIMIT_PER_MIN"), 120)
    window_s = _int_from_env(os.environ.get("CHASEMAPPER_SOCKETIO_RATE_LIMIT_WINDOW_S"), 60)
    # Coarser backstop shared by every client_id reported from the same source
    # IP, so one address can't dodge the per-person limit below by minting
    # many fake client_ids. Deliberately generous relative to `limit` - it's
    # a defense against abuse, not a cap on how many real people can
    # legitimately share one network (e.g. a chase club on one LAN/hotspot).
    ip_limit = _int_from_env(
        os.environ.get("CHASEMAPPER_SOCKETIO_RATE_LIMIT_PER_IP_PER_MIN"), limit * 20
    )
    return enabled, limit, window_s, ip_limit


# Simple presence tracking: which Socket.IO sessions are currently connected,
# so every client can show "N connected" without polling. Broadcast on every
# connect/disconnect rather than computed on demand, since it's cheap and
# rare (connection churn, not a per-telemetry-tick event).
connected_sids = set()
connected_sids_lock = Lock()


def _broadcast_presence():
    with connected_sids_lock:
        _count = len(connected_sids)
    socketio.emit("presence_update", {"connected": _count}, namespace="/chasemapper")


# Tracks which Socket.IO session ("sid") currently "owns" each independently
# -tracked chase-car client_id, so one browser can't spoof another's live
# position by reusing/guessing their client_id while that browser is still
# actively connected. A client_id is free to be (re)claimed by any sid once
# its previous owner disconnects (see the `disconnect` handler below).
# A lease, not a permanent lock: an owner that stops sending device_position
# updates for longer than this is assumed to be a dead connection (network
# drop that Socket.IO's own ping-timeout hasn't noticed yet - realistic on a
# flaky cell connection in a moving car) and a reconnecting client with the
# same client_id is allowed to take back over, rather than being locked out
# until Socket.IO's ping-timeout eventually fires the `disconnect` event.
CLIENT_CAR_OWNERSHIP_GRACE_S = 20.0

client_car_owners = {}  # client_id -> (sid, last_seen_monotonic)
client_car_owners_by_sid = {}  # sid -> set of client_ids
client_car_owners_lock = Lock()


def _claim_client_car_ownership(client_id, sid):
    """Return True if `sid` is allowed to act as `client_id` right now."""
    with client_car_owners_lock:
        _owner = client_car_owners.get(client_id)
        if _owner is not None:
            _owner_sid, _last_seen = _owner
            if _owner_sid != sid and (time.monotonic() - _last_seen) < CLIENT_CAR_OWNERSHIP_GRACE_S:
                return False
            if _owner_sid != sid:
                # Stale lease (owner gone quiet past the grace period) - release it
                # from its old sid's bookkeeping before handing it to the new one.
                _old_owned = client_car_owners_by_sid.get(_owner_sid)
                if _old_owned is not None:
                    _old_owned.discard(client_id)
                    if not _old_owned:
                        client_car_owners_by_sid.pop(_owner_sid, None)
        client_car_owners[client_id] = (sid, time.monotonic())
        client_car_owners_by_sid.setdefault(sid, set()).add(client_id)
        return True


def _release_client_car_ownership(sid):
    with client_car_owners_lock:
        _owned = client_car_owners_by_sid.pop(sid, None)
        if not _owned:
            return
        for _client_id in _owned:
            _owner = client_car_owners.get(_client_id)
            if _owner is not None and _owner[0] == sid:
                client_car_owners.pop(_client_id, None)


@socketio.on("connect", namespace="/chasemapper")
def handle_socketio_connect(auth=None):
    """Reject the Socket.IO connection outright if an API key is configured
    and required for this client's IP (mirrors the REST API's policy)."""
    if _require_socketio_connect_auth() and _request_api_key() != _get_configured_api_key():
        logging.warning(
            "Rejected Socket.IO connection from %s: missing/invalid API key.",
            _get_client_ip(),
        )
        raise ConnectionRefusedError("unauthorized")

    with connected_sids_lock:
        connected_sids.add(flask.request.sid)
    _broadcast_presence()


@socketio.on("disconnect", namespace="/chasemapper")
def handle_socketio_disconnect():
    try:
        _release_client_car_ownership(flask.request.sid)
    except Exception:
        logging.exception("Error releasing client car ownership on disconnect")

    with connected_sids_lock:
        connected_sids.discard(flask.request.sid)
    _broadcast_presence()


@app.before_request
def enforce_api_endpoint_security():
    # Guard only external route/state API surfaces.
    guarded_paths = {
        "/api/route",
        "/api/latest_route",
        "/api/mobile_state",
    }

    path = flask.request.path or ""
    method = flask.request.method or ""
    if path not in guarded_paths:
        return None

    # Skip auth/rate-limit in testing mode to keep test fixtures simple.
    if _testing_mode():
        return None

    client_ip = _get_client_ip() or "unknown"

    # API-key auth (policy driven).
    configured_key = _get_configured_api_key()
    if _require_api_auth_for_request(client_ip, configured_key):
        req_key = _request_api_key()
        if req_key != configured_key:
            return flask.jsonify({"error": "unauthorized"}), 401

    # Per-IP rate limiting.
    rl_enabled, rl_limit, rl_window_s = _rate_limit_config_for_endpoint(path, method)
    if rl_enabled:
        ok, retry_after_s = _consume_rate_limit(client_ip, f"{method}:{path}", rl_limit, rl_window_s)
        if not ok:
            resp = flask.jsonify({
                "error": "rate limit exceeded",
                "retry_after_s": retry_after_s,
            })
            resp.status_code = 429
            resp.headers["Retry-After"] = str(retry_after_s)
            return resp

    return None


def _utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def _safe_float_or_none(value):
    try:
        parsed = float(value)
        if math.isfinite(parsed):
            return parsed
    except Exception:
        pass
    return None


def _ttl_string_to_seconds(ttl_text):
    """Convert TTL string formats like MM:SS / HH:MM:SS / LANDED to seconds."""
    if ttl_text is None:
        return None
    text = str(ttl_text).strip().upper()
    if text == "":
        return None
    if text == "LANDED":
        return 0
    parts = text.split(":")
    try:
        nums = [int(p) for p in parts]
    except Exception:
        return None

    if len(nums) == 2:
        return (nums[0] * 60) + nums[1]
    if len(nums) == 3:
        return (nums[0] * 3600) + (nums[1] * 60) + nums[2]
    return None


def _extract_route_metrics(geojson):
    """Best-effort route metrics extraction from GeoJSON properties."""
    if not isinstance(geojson, dict):
        return {
            "distance_m": None,
            "duration_s": None,
            "updated_at": None,
        }

    props = geojson.get("properties", {}) if isinstance(geojson.get("properties"), dict) else {}
    distance_m = _safe_float_or_none(props.get("distance_m", props.get("distance")))
    duration_s = _safe_float_or_none(props.get("duration_s", props.get("duration")))
    updated_at = props.get("updated_at")
    return {
        "distance_m": distance_m,
        "duration_s": duration_s,
        "updated_at": updated_at,
    }


def _select_mobile_target(payloads_snapshot):
    """Choose the most recent payload with a valid predicted landing."""
    best = None
    best_time = -1.0

    for callsign, payload in payloads_snapshot.items():
        if not isinstance(payload, dict):
            continue

        pred_landing = payload.get("pred_landing", [])
        if not isinstance(pred_landing, (list, tuple)) or len(pred_landing) < 2:
            continue

        telem = payload.get("telem", {}) if isinstance(payload.get("telem"), dict) else {}
        server_time = _safe_float_or_none(telem.get("server_time")) or 0.0
        if server_time > best_time:
            best_time = server_time
            best = (callsign, payload)

    if best is None:
        return None

    callsign, payload = best
    telem = payload.get("telem", {}) if isinstance(payload.get("telem"), dict) else {}
    pred_landing = payload.get("pred_landing", [])
    ttl_text = telem.get("time_to_landing", "")

    landing_alt = None
    if len(pred_landing) >= 3:
        landing_alt = _safe_float_or_none(pred_landing[2])

    return {
        "callsign": callsign,
        "landing": {
            "lat": _safe_float_or_none(pred_landing[0]),
            "lon": _safe_float_or_none(pred_landing[1]),
            "alt": landing_alt,
        },
        "telemetry": telem,
        "time_to_landing": ttl_text,
        "time_to_landing_s": _ttl_string_to_seconds(ttl_text),
    }


def _get_osrm_base_url():
    """Return OSRM base URL from config/env/default."""
    try:
        cfg_url = chasemapper_config.get("osrm_base_url", "")
    except Exception:
        cfg_url = ""

    env_url = os.environ.get("CHASEMAPPER_OSRM_BASE_URL", "")
    base_url = (cfg_url or env_url or "https://router.project-osrm.org").strip().rstrip("/")
    return base_url


def _fetch_osrm_route(start_lat, start_lon, end_lat, end_lon, timeout_s=8.0):
    """Fetch driving route(s) from OSRM and return the full routes list.

    Requests `steps=true` (turn-by-turn maneuvers, for the mobile app's
    turn list) and `alternatives=true` (mirrors the desktop web app's
    Fastest/Shortest picker in static/js/chase_routing.js).
    """
    base_url = _get_osrm_base_url()
    url = (
        f"{base_url}/route/v1/driving/"
        f"{start_lon},{start_lat};{end_lon},{end_lat}"
    )
    params = {
        "overview": "full",
        "geometries": "geojson",
        "steps": "true",
        "alternatives": "true",
        "annotations": "distance,duration",
    }
    resp = requests.get(url, params=params, timeout=timeout_s)
    resp.raise_for_status()
    data = resp.json()
    routes = data.get("routes", []) if isinstance(data, dict) else []
    if not routes:
        raise ValueError("No routes returned by OSRM")
    return routes, base_url


def _normalize_osrm_steps(route):
    """Flatten an OSRM route's legs/steps into a compact turn-by-turn list.

    `location` (the maneuver's [lon, lat]) is kept so mobile clients can figure out
    which steps the chase car has already passed by projecting its own position onto
    the route geometry - see utils/routeProgress.ts on the mobile side.
    """
    steps_out = []
    for leg in route.get("legs", []) or []:
        for step in leg.get("steps", []) or []:
            maneuver = step.get("maneuver") if isinstance(step.get("maneuver"), dict) else {}
            location = maneuver.get("location")
            steps_out.append({
                "type": maneuver.get("type"),
                "modifier": maneuver.get("modifier"),
                "name": step.get("name") or "",
                "distance_m": _safe_float_or_none(step.get("distance")) or 0.0,
                "location": location if isinstance(location, list) and len(location) == 2 else None,
            })
    return steps_out


def _pick_route_alternatives(routes):
    """Return (fastest, shortest) routes from OSRM's alternatives list.

    Mirrors the desktop web app's selection in chase_routing.js: fastest =
    minimum duration, shortest = minimum distance (falling back to the
    same route for both when only one candidate is returned).
    """
    fastest = min(routes, key=lambda r: r.get("duration", float("inf")))
    shortest = min(routes, key=lambda r: r.get("distance", float("inf")))
    return fastest, shortest


def create_app():
    """Return the Flask `app` and configured `socketio` instance.

    This helper allows tests to import the application object without
    triggering any startup side-effects. Use `start_services()` to
    initialise background listeners and other long-running components.
    """
    return app, socketio


def start_services(config_path: str = None, *, start_listeners_flag: bool = True, start_predictor_flag: bool = True):
    """Initialise server globals and optionally start background services.

    - `config_path`: path to configuration file. If omitted, default
      behaviour mirrors the original CLI which looks for `horusmapper.cfg`.
    - `start_listeners_flag`: start UDP/serial listeners when True
    - `start_predictor_flag`: start predictor when True
    """
    global chasemapper_config, pred_settings, map_settings, bearing_store
    global car_track, chase_logger, data_listeners, aprs_tracker
    global aprs_prediction_overrides_path

    _default_cfg = "horusmapper.cfg"
    if os.path.isdir(_default_cfg):
        _candidate = os.path.join(_default_cfg, "horusmapper.cfg")
        if os.path.isfile(_candidate):
            _default_cfg = _candidate

    cfg_path = config_path or _default_cfg

    # Read config file
    chasemapper_config = read_config(cfg_path)
    if chasemapper_config is None:
        raise RuntimeError("Could not read configuration data")

    # Add version
    chasemapper_config["version"] = CHASEMAPPER_VERSION
    chasemapper_config.setdefault("pred_model_time", "—")
    aprs_prediction_overrides_path = os.path.join(_config_base_dir(cfg_path), "aprs_prediction_overrides.json")
    chasemapper_config["aprs_prediction_overrides"] = _load_aprs_prediction_overrides()

    # Predictor settings and map settings
    pred_settings = {
        "pred_binary": chasemapper_config.get("pred_binary"),
        "gfs_path": chasemapper_config.get("pred_gfs_directory") or chasemapper_config.get("gfs_directory"),
        "pred_model_download": chasemapper_config.get("pred_model_download"),
    }

    map_settings = {
        "tile_server_enabled": chasemapper_config.get("tile_server_enabled", False),
        "tile_server_path": chasemapper_config.get("tile_server_path", ""),
    }

    # Initialise Bearing store
    try:
        bearing_store = Bearings(
            socketio_instance=socketio,
            max_bearings=chasemapper_config.get("max_bearings", 300),
            max_bearing_age=chasemapper_config.get("max_bearing_age", 10),
        )
    except Exception:
        bearing_store = None

    # Set speed gate thresholds on the car track object
    try:
        car_track.heading_gate_threshold = chasemapper_config.get("car_speed_gate", car_track.heading_gate_threshold)
        car_track.turn_rate_threshold = chasemapper_config.get("turn_rate_threshold", car_track.turn_rate_threshold)
    except Exception:
        pass

    # Start listeners & services if requested
    if start_listeners_flag:
        start_listeners(chasemapper_config["profiles"][chasemapper_config["selected_profile"]])

    # Start predictor if enabled and requested
    if start_predictor_flag and chasemapper_config.get("pred_enabled"):
        try:
            initPredictor()
        except Exception:
            logging.exception("Failed to initialise predictor")

    # Start data age monitor thread
    global data_monitor_thread_running
    data_monitor_thread_running = True
    _data_age_monitor = Thread(target=check_data_age)
    _data_age_monitor.daemon = True
    _data_age_monitor.start()

    # Start APRS tracker if enabled
    if chasemapper_config.get("aprs_enabled", False):
        try:
            _calls = chasemapper_config.get("aprs_callsigns", [])
            if len(_calls) > 0:
                process_new_aprs_callsigns(_calls)
        except Exception:
            logging.exception("Failed to start APRS tracker")



# Chase Logger Instance (Initialised in main)
chase_logger = None

# Global stores of data.

# These settings are shared between server and all clients, and are updated dynamically.
chasemapper_config = {}
aprs_prediction_overrides_path = None

# Pointers to objects containing data listeners.
# These should all present a .close() function which will be called on
# listener profile change, or program exit.
data_listeners = []

# These settings are not editable by the client!
pred_settings = {}

# Offline map settings, again, not editable by the client.
map_settings = {"tile_server_enabled": False}


def _config_base_dir(config_path):
    if not config_path:
        return os.getcwd()

    resolved = os.path.abspath(config_path)
    if os.path.isdir(resolved):
        return resolved

    base_dir = os.path.dirname(resolved)
    if base_dir:
        return base_dir
    return os.getcwd()


def _sanitize_aprs_prediction_overrides(overrides):
    sanitized = {}
    if not isinstance(overrides, dict):
        return sanitized

    for callsign, values in overrides.items():
        key = (callsign or "").upper()
        if not key or not isinstance(values, dict):
            continue

        item = {}
        for field in ["pred_burst", "pred_desc_rate"]:
            if field in values:
                try:
                    item[field] = float(values[field])
                except Exception:
                    pass

        if item:
            sanitized[key] = item

    return sanitized


def _format_predictor_model_time(model_time):
    if model_time is None:
        return "—"

    try:
        if isinstance(model_time, str):
            model_time = parse_dt(model_time)

        if getattr(model_time, "tzinfo", None) is None:
            model_time = pytz.utc.localize(model_time)
        else:
            model_time = model_time.astimezone(pytz.utc)

        tz_name = model_time.tzname() or "UTC"
        return model_time.strftime("%m/%d/%Y, %H:%M:%S ") + tz_name
    except Exception:
        logging.debug("Unable to format predictor model time: %s", traceback.format_exc())
        return "—"


def _emit_predictor_model_status(model, model_time=None):
    chasemapper_config["pred_model"] = model
    chasemapper_config["pred_model_time"] = _format_predictor_model_time(model_time)
    flask_emit_event(
        "predictor_model_update",
        {"model": chasemapper_config["pred_model"], "time": chasemapper_config["pred_model_time"]},
    )


def _load_aprs_prediction_overrides():
    global aprs_prediction_overrides_path

    if not aprs_prediction_overrides_path or not os.path.isfile(aprs_prediction_overrides_path):
        return {}

    try:
        with open(aprs_prediction_overrides_path, "r") as fh:
            loaded = json.load(fh)
        return _sanitize_aprs_prediction_overrides(loaded)
    except Exception as exc:
        logging.error("Failed to load APRS prediction overrides: %s", str(exc))
        return {}


def _save_aprs_prediction_overrides():
    global aprs_prediction_overrides_path

    if not aprs_prediction_overrides_path:
        return

    overrides = _sanitize_aprs_prediction_overrides(chasemapper_config.get("aprs_prediction_overrides", {}))
    try:
        tmp_path = aprs_prediction_overrides_path + ".tmp"
        with open(tmp_path, "w") as fh:
            json.dump(overrides, fh, indent=2, sort_keys=True)
        os.replace(tmp_path, aprs_prediction_overrides_path)
    except Exception as exc:
        logging.error("Failed to save APRS prediction overrides: %s", str(exc))


def _normalize_aprs_callsign(callsign):
    return (callsign or "").strip().upper()


def _set_server_aprs_callsigns(callsigns):
    normalized = []
    for callsign in callsigns or []:
        key = _normalize_aprs_callsign(callsign)
        if key and key not in normalized:
            normalized.append(key)
    chasemapper_config["aprs_callsigns"] = normalized
    return normalized


def _remove_server_payload_for_callsign(callsign):
    key = _normalize_aprs_callsign(callsign)
    if not key:
        return

    # Remove payload state under lock to avoid races with other threads.
    with payloads_lock:
        current_payloads.pop(key, None)
        current_payload_tracks.pop(key, None)


def _start_aprs_tracker_for_callsigns(callsigns):
    _calls = [_normalize_aprs_callsign(cs) for cs in callsigns or [] if _normalize_aprs_callsign(cs)]
    if not _calls:
        if aprs_tracker is not None:
            try:
                aprs_tracker.stop()
                aprs_tracker.join(timeout=2)
            except Exception as e:
                logging.error("Error stopping APRS tracker: %s", str(e))
        return

    start_or_restart_aprs_tracker(_calls)


def _apply_aprs_callsign_add(callsign):
    key = _normalize_aprs_callsign(callsign)
    if not key:
        return False

    callsigns = list(chasemapper_config.get("aprs_callsigns", []))
    if key in [(_normalize_aprs_callsign(cs)) for cs in callsigns]:
        return False

    callsigns.append(key)
    _set_server_aprs_callsigns(callsigns)
    return True


def _apply_aprs_callsign_remove(callsign):
    key = _normalize_aprs_callsign(callsign)
    if not key:
        return False

    current = [_normalize_aprs_callsign(cs) for cs in chasemapper_config.get("aprs_callsigns", []) if _normalize_aprs_callsign(cs)]
    if key not in current:
        return False

    chasemapper_config["aprs_callsigns"] = [cs for cs in current if cs != key]
    _remove_server_payload_for_callsign(key)
    overrides = _sanitize_aprs_prediction_overrides(chasemapper_config.get("aprs_prediction_overrides", {}))
    if key in overrides:
        del overrides[key]
        chasemapper_config["aprs_prediction_overrides"] = overrides
        _save_aprs_prediction_overrides()
    return True

# Payload data Stores
current_payloads = {}  #  Archive data which will be passed to the web client
current_payload_tracks = (
    {}
)  # Store of payload Track objects which are used to calculate instantaneous parameters.

# Hard ceiling on current_payloads[callsign]["path"] (the raw [lat, lon, alt] list
# sent to web clients for flight-path rendering) so a multi-hour/multi-day session
# doesn't grow it without bound. Mirrors GenericTrack.MAX_TRACK_HISTORY.
MAX_TELEMETRY_PATH_POINTS = 20000

# Lock protecting access to `current_payloads` and `current_payload_tracks`.
payloads_lock = Lock()

# Chase car position (the "primary" car - hardware GPS/UDP feed, or the
# default identity for a lone browser that isn't sharing its own device
# location).
car_track = GenericTrack()

# Additional, independently-tracked chase cars, keyed by a client-supplied
# id (persisted per-browser in localStorage). This lets multiple people
# connect to the same server and each have their own live position tracked
# separately, instead of everyone overwriting the single `car_track` above.
# Each entry is {"track": GenericTrack(), "name": str, "last_seen": float}.
client_car_tracks = {}
client_car_tracks_lock = Lock()

# Bearing store
bearing_store = None
bearing_mode = False # Flag to indicate if we are receiving bearings

# Habitat/Sondehub Chase-Car uploader object
online_uploader = None
# APRS tracker instance (if enabled)
aprs_tracker = None

# Copy out any extra fields from incoming telemetry that we want to pass on to the GUI.
# At the moment we're really only using the burst timer field.
EXTRA_FIELDS = ["bt", "temp", "humidity", "sats", "snr"]


#
#   Flask Routes
#


@app.route("/")
def flask_index():
    """ Render main index page """
    return flask.render_template("index.html")

@app.route("/bearing")
def flask_bearing_entry():
    """ Render bearing entry page """
    return flask.render_template("bearing_entry.html")

@app.route("/oclock")
def flask_oclock():
    """ Render bearing o'clock page """
    return flask.render_template("oclock.html")

@app.route("/get_telemetry_archive")
def flask_get_telemetry_archive():
    return json.dumps(current_payloads)


@app.route("/get_config")
def flask_get_config():
    return json.dumps(chasemapper_config)


@app.route("/get_bearings")
def flask_get_bearings():
    return json.dumps(bearing_store.bearings)


# Some features of the web interface require comparisons with server time,
# so provide a route to grab it.
@app.route("/server_time")
def flask_get_server_time():
    return json.dumps(time.time())


def _testing_mode():
    """Return True when the app is running in testing mode.

    Tests should set the environment variable `CHASEMAPPER_TESTING=1` to enable
    test-only endpoints and to disable background listeners when the server is
    launched from tests.
    """
    return os.environ.get("CHASEMAPPER_TESTING", "").lower() in ("1", "true", "yes")


@app.route('/test/state')
def flask_test_state():
    """Return a small JSON snapshot of server state for GUI/integration tests.

    This endpoint is only available when `CHASEMAPPER_TESTING=1` to avoid
    exposing internal state in production.
    """
    if not _testing_mode():
        flask.abort(404)

    # Provide a minimal serialisable view of current payloads and config.
    try:
        payloads = {}
        for k, v in current_payloads.items():
            payloads[k] = {
                'telem': v.get('telem'),
                'pred_path': v.get('pred_path', []),
                'pred_landing': v.get('pred_landing', []),
            }
    except Exception:
        payloads = {}

    state = {
        'config': chasemapper_config,
        'aprs_callsigns': chasemapper_config.get('aprs_callsigns', []),
        'current_payloads': payloads,
    }
    return json.dumps(state)


@app.route("/tiles/<path:filename>")
def flask_server_tiles(filename):
    """ Serve up a file from the tile server location """
    global map_settings
    if map_settings["tile_server_enabled"]:
        return flask.send_from_directory(map_settings["tile_server_path"], filename)
    else:
        flask.abort(404)


@app.route('/api/latest_route', methods=['GET', 'POST'])
def api_latest_route():
    """GET returns the last stored route (GeoJSON). POST stores a route.

    POST expects a GeoJSON Feature (application/json) in the request body.
    """
    global latest_route_geojson, latest_route_meta
    if flask.request.method == 'POST':
        try:
            data = flask.request.get_json(force=True)
            if not data or 'type' not in data:
                return flask.jsonify({'error': 'invalid geojson'}), 400
            with latest_route_lock:
                latest_route_geojson = data
                metrics = _extract_route_metrics(data)
                latest_route_meta = {
                    "distance_m": metrics.get("distance_m"),
                    "duration_s": metrics.get("duration_s"),
                    "provider": "client-push",
                    "provider_base": None,
                    "updated_at": metrics.get("updated_at") or _utc_now_iso(),
                }
            return flask.jsonify({'status': 'ok'}), 200
        except Exception:
            logging.exception('Failed to set latest_route')
            return flask.jsonify({'error': 'server error'}), 500

    # GET
    with latest_route_lock:
        if latest_route_geojson is None:
            return flask.jsonify({'error': 'no route'}), 404
        return flask.jsonify(latest_route_geojson), 200


@app.route('/api/route', methods=['POST'])
def api_route():
    """Compute a route via backend OSRM and return normalized response.

    Request JSON:
    {
      "start_lat": float,
      "start_lon": float,
      "end_lat": float,
      "end_lon": float
    }

    Response JSON:
    {
      "feature": <GeoJSON Feature>,
      "distance_m": float,
      "duration_s": float,
      "provider": "osrm",
      "provider_base": "https://...",
      "steps": [{"type": str, "modifier": str|null, "name": str, "distance_m": float}, ...],
      "alternatives": [{"label": "fastest"|"shortest", "feature": ..., "distance_m": ..., "duration_s": ..., "steps": ...}, ...]
    }

    `steps`/`alternatives` mirror the fastest route; the desktop web app's
    turn list is computed separately client-side (Leaflet Routing Machine),
    but mobile clients have no equivalent, so the backend does it here.
    """
    global latest_route_geojson, latest_route_meta, client_routes

    try:
        payload = flask.request.get_json(force=True) or {}
    except Exception:
        return flask.jsonify({"error": "invalid json"}), 400

    try:
        start_lat = float(payload.get("start_lat"))
        start_lon = float(payload.get("start_lon"))
        end_lat = float(payload.get("end_lat"))
        end_lon = float(payload.get("end_lon"))
    except Exception:
        return flask.jsonify({"error": "invalid coordinates"}), 400

    # Identifies which mobile chaser this route belongs to, so it's stored under
    # client_routes instead of the shared latest_route_geojson/latest_route_meta
    # globals (desktop, which has no client_id, keeps using those as before).
    client_id = payload.get("client_id")
    if not isinstance(client_id, str) or not client_id.strip():
        client_id = None

    try:
        routes, provider_base = _fetch_osrm_route(start_lat, start_lon, end_lat, end_lon)
        fastest, shortest = _pick_route_alternatives(routes)

        def _build_alternative(route, label):
            geometry = route.get("geometry", {"type": "LineString", "coordinates": []})
            feature = {
                "type": "Feature",
                "geometry": geometry,
                "properties": {
                    "source": "osrm-backend",
                    "distance_m": route.get("distance", 0.0),
                    "duration_s": route.get("duration", 0.0),
                    "updated_at": _utc_now_iso(),
                },
            }
            return {
                "label": label,
                "feature": feature,
                "distance_m": route.get("distance", 0.0),
                "duration_s": route.get("duration", 0.0),
                "steps": _normalize_osrm_steps(route),
            }

        alternatives = [_build_alternative(fastest, "fastest"), _build_alternative(shortest, "shortest")]
        primary = alternatives[0]
        primary_meta = {
            "distance_m": primary["distance_m"],
            "duration_s": primary["duration_s"],
            "provider": "osrm",
            "provider_base": provider_base,
            "updated_at": primary["feature"]["properties"]["updated_at"],
            "steps": primary["steps"],
        }

        if client_id:
            with client_routes_lock:
                client_routes[client_id] = {
                    "geojson": primary["feature"],
                    "meta": primary_meta,
                    "last_seen": time.time(),
                }
        else:
            with latest_route_lock:
                latest_route_geojson = primary["feature"]
                latest_route_meta = primary_meta

        return flask.jsonify(
            {
                "feature": primary["feature"],
                "distance_m": primary["distance_m"],
                "duration_s": primary["duration_s"],
                "provider": "osrm",
                "provider_base": provider_base,
                "steps": primary["steps"],
                "alternatives": alternatives,
            }
        ), 200
    except requests.RequestException:
        logging.exception("OSRM request failed")
        return flask.jsonify({"error": "routing backend unavailable"}), 502
    except Exception:
        logging.exception("Route computation failed")
        return flask.jsonify({"error": "route computation failed"}), 500


@app.route('/api/mobile_state', methods=['GET'])
def api_mobile_state():
    """Return compact chase state bundle for mobile clients.

    Includes car position, selected target landing, latest route, and ETA fields
    in a single response to reduce mobile polling fan-out.
    """
    # Snapshot shared state under locks for consistency.
    try:
        with payloads_lock:
            payloads_snapshot = dict(current_payloads)
    except Exception:
        payloads_snapshot = {}

    # Each mobile chaser only ever sees their OWN route here, keyed by the
    # client_id they sent with their /api/route call — never another client's
    # (or the desktop web app's) in-flight route. A client_id with no stored
    # route yet (or an old client that didn't send one) gets no route at all
    # rather than falling back to some other client's state.
    client_id = (flask.request.args.get("client_id") or "").strip() or None
    if client_id:
        with client_routes_lock:
            _entry = client_routes.get(client_id)
        if _entry:
            route_geojson = _entry["geojson"]
            route_meta_snapshot = dict(_entry["meta"])
        else:
            route_geojson = None
            route_meta_snapshot = {}
    else:
        with latest_route_lock:
            route_geojson = latest_route_geojson
            route_meta_snapshot = dict(latest_route_meta)

    car_state = None
    try:
        _state = car_track.get_latest_state()
        if _state:
            time_val = _state.get("time")
            if hasattr(time_val, "isoformat"):
                time_iso = time_val.isoformat()
            else:
                time_iso = None

            car_state = {
                "lat": _safe_float_or_none(_state.get("lat")),
                "lon": _safe_float_or_none(_state.get("lon")),
                "alt": _safe_float_or_none(_state.get("alt")),
                "speed": _safe_float_or_none(_state.get("speed")),
                "heading": _safe_float_or_none(_state.get("heading")),
                "heading_valid": bool(_state.get("heading_valid", False)),
                "last_update": time_iso,
            }
    except Exception:
        car_state = None

    target = _select_mobile_target(payloads_snapshot)

    # Route ETA for driving is based on latest route duration if known.
    route_duration_s = _safe_float_or_none(route_meta_snapshot.get("duration_s"))
    if route_duration_s is None:
        extracted = _extract_route_metrics(route_geojson)
        route_duration_s = extracted.get("duration_s")
        if route_meta_snapshot.get("updated_at") is None:
            route_meta_snapshot["updated_at"] = extracted.get("updated_at")

    response = {
        "server_time": _utc_now_iso(),
        "car": car_state,
        "target": target,
        "route": {
            "geojson": route_geojson,
            "distance_m": _safe_float_or_none(route_meta_snapshot.get("distance_m")),
            "duration_s": route_duration_s,
            "provider": route_meta_snapshot.get("provider"),
            "provider_base": route_meta_snapshot.get("provider_base"),
            "updated_at": route_meta_snapshot.get("updated_at"),
            "steps": route_meta_snapshot.get("steps"),
        },
        "eta": {
            "route_duration_s": route_duration_s,
            "payload_time_to_landing_s": target.get("time_to_landing_s") if target else None,
            "payload_time_to_landing": target.get("time_to_landing") if target else None,
        },
    }

    return flask.jsonify(response), 200


def flask_emit_event(event_name="none", data={}):
    """ Emit a socketio event to any clients. """
    socketio.emit(event_name, data, namespace="/chasemapper")


@socketio.on("client_connected", namespace="/chasemapper")
def client_connected(_data):
    """Replay current telemetry state to a newly connected client."""
    try:
        # Snapshot payloads under lock to avoid concurrent mutation while iterating.
        with payloads_lock:
            payloads_snapshot = list(current_payloads.values())

        for payload in payloads_snapshot:
            telem = payload.get("telem")
            if telem:
                socketio.emit(
                    "telemetry_event",
                    telem,
                    namespace="/chasemapper",
                    room=flask.request.sid,
                )

            _callsign = telem.get("callsign") if telem else None
            if _callsign:
                pred_payload = {
                    "callsign": _callsign,
                    "pred_path": payload.get("pred_path", []),
                    "pred_landing": payload.get("pred_landing", []),
                    "burst": payload.get("burst", []),
                    "abort_path": payload.get("abort_path", []),
                    "abort_landing": payload.get("abort_landing", []),
                }

                if pred_payload["pred_path"] or pred_payload["pred_landing"]:
                    socketio.emit(
                        "predictor_update",
                        pred_payload,
                        namespace="/chasemapper",
                        room=flask.request.sid,
                    )

        # Also replay the latest known position of every other independently
        # tracked chase car, so a newly-connected client immediately sees
        # everyone already active rather than waiting for their next update.
        with client_car_tracks_lock:
            client_cars_snapshot = [
                (_cid, _entry["track"].get_latest_state(), _entry["name"])
                for _cid, _entry in client_car_tracks.items()
            ]

        for _client_id, _state, _name in client_cars_snapshot:
            if not _state:
                continue
            socketio.emit(
                "telemetry_event",
                {
                    "callsign": "CAR",
                    "car_id": _client_id,
                    "car_name": _name,
                    "position": [_state["lat"], _state["lon"], _state["alt"]],
                    "vel_v": 0.0,
                    "heading": _state["heading"],
                    "heading_valid": _state["heading_valid"],
                    "heading_status": _state["heading_status"],
                    "speed": _state["speed"],
                },
                namespace="/chasemapper",
                room=flask.request.sid,
            )
    except Exception as e:
        logging.debug("Error replaying telemetry to client: %s", str(e))


@socketio.on("aprs_refresh_request", namespace="/chasemapper")
def aprs_refresh_request(data):
    """Fetch and inject the most recent APRS beacon for a single callsign."""

    callsign = (data.get("callsign") or "").strip().upper()
    if not callsign:
        logging.warning("APRS refresh requested without a callsign.")
        return

    def _refresh() -> None:
        success = False
        try:
            logging.info("APRS refresh requested for %s", callsign)
            success = process_new_aprs_callsigns([callsign], restart_tracker=False)
        except Exception as exc:
            logging.error("APRS refresh failed for %s: %s", callsign, exc)
        finally:
            socketio.emit(
                "aprs_refresh_complete",
                {"callsign": callsign, "success": bool(success)},
                namespace="/chasemapper",
            )

    thread = Thread(target=_refresh)
    thread.daemon = True
    thread.start()


# Config keys the browser UI is actually allowed to change via
# client_settings_update. The client emits its whole local `chase_config`
# object (not a delta), so a naive `chasemapper_config.update(data)` would let
# any connected client overwrite server-only settings it happens to be
# carrying (file paths, GPSD/serial ports, API keys, the network bind
# address, ...) or inject arbitrary new keys. Restricting the merge to this
# allow-list keeps client_settings_update limited to the toggles the Settings
# UI exposes. aprs_callsigns/aprs_prediction_overrides are handled separately
# below (server-owned); selected_profile has its own "profile_change" event.
# Keys the server accepts from a `client_settings_update` push and applies to
# the shared `chasemapper_config` (which is then broadcast to every connected
# client). This is intentionally restricted to settings that actually change
# *server-side* behaviour - a running thread, a compute budget, or data that's
# genuinely shared across everyone (e.g. the synchronised time-sync hunt).
#
# Purely cosmetic/display preferences (unit selection, map colours, line
# styles, 2D/3D mode, timezone display, default map centre, etc.) are
# intentionally NOT here - they're personal per-browser choices that live in
# localStorage (see LOCAL_DISPLAY_CONFIG_KEYS client-side) and must never be
# pushed through the server to other people's browsers.
CLIENT_SETTABLE_CONFIG_KEYS = frozenset((
    "aprs_enabled",
    "aprs_poll_interval",
    "habitat_call",
    "habitat_update_rate",
    "habitat_upload_enabled",
    "max_bearing_age",
    "pred_burst",
    "pred_desc_rate",
    "pred_enabled",
    "pred_model",
    "pred_model_time",
    "pred_update_rate",
    "show_abort",
    "time_seq_active",
    "time_seq_cycle",
    "time_seq_enabled",
    "time_seq_times",
))


@socketio.on("client_settings_update", namespace="/chasemapper")
def client_settings_update(data):
    global chasemapper_config, online_uploader
    global aprs_tracker, predictor

    try:
        logging.info(
            "client_settings_update received: aprs_enabled=%s",
            data.get("aprs_enabled", False),
        )
    except Exception:
        pass

    # Cache predictor state to reduce dict lookups
    _old_pred_enabled = chasemapper_config.get("pred_enabled", False)
    _new_pred_enabled = data.get("pred_enabled", False)
    _predictor_change = "none"
    if (not _old_pred_enabled) and _new_pred_enabled:
        _predictor_change = "restart"
    elif _old_pred_enabled and (not _new_pred_enabled):
        _predictor_change = "stop"

    # Cache habitat state to reduce dict lookups
    _old_habitat_enabled = chasemapper_config.get("habitat_upload_enabled", False)
    _new_habitat_enabled = data.get("habitat_upload_enabled", False)
    _habitat_change = "none"
    if (not _old_habitat_enabled) and _new_habitat_enabled:
        _habitat_change = "start"
    elif _old_habitat_enabled and (not _new_habitat_enabled):
        _habitat_change = "stop"

    _old_aprs_enabled = chasemapper_config.get("aprs_enabled", False)
    _new_aprs_enabled = data.get("aprs_enabled", False)
    _server_aprs_callsigns = list(chasemapper_config.get("aprs_callsigns", []))
    _server_aprs_overrides = _sanitize_aprs_prediction_overrides(chasemapper_config.get("aprs_prediction_overrides", {}))

    # Apply only the known client-settable keys from the client payload, rather
    # than blindly merging the whole object (see CLIENT_SETTABLE_CONFIG_KEYS).
    for _key in CLIENT_SETTABLE_CONFIG_KEYS:
        if isinstance(data, dict) and _key in data:
            chasemapper_config[_key] = data[_key]
    # APRS state is server-owned; ignore any client-supplied values for it.
    chasemapper_config["aprs_callsigns"] = _server_aprs_callsigns
    chasemapper_config["aprs_prediction_overrides"] = _server_aprs_overrides

    if _predictor_change == "restart":
        # Wait until any current prediction has finished (bounded, rather than
        # polling indefinitely) before touching the predictor object.
        predictor_idle_event.wait(timeout=10.0)
        # Attempt to start the predictor.
        initPredictor()
    elif _predictor_change == "stop":
        # Wait until any current prediction has finished.
        predictor_idle_event.wait(timeout=10.0)

        predictor = None

    # Start or Stop the Habitat Chase-Car Uploader.
    if _habitat_change == "start":
        if online_uploader == None:
            _tracker = chasemapper_config["profiles"][
                chasemapper_config["selected_profile"]
            ]["online_tracker"]
            if _tracker == "habitat":
                logging.error(
                    "Habitat uploader now deprecated due to Habitat retirement, not starting uploader."
                )
            elif _tracker == "sondehub":
                online_uploader = SondehubChaseUploader(
                    update_rate=chasemapper_config["habitat_update_rate"],
                    callsign=chasemapper_config["habitat_call"],
                )
            elif _tracker == "sondehubamateur":
                online_uploader = SondehubChaseUploader(
                    update_rate=chasemapper_config["habitat_update_rate"],
                    callsign=chasemapper_config["habitat_call"],
                    amateur=True
                )
            else:
                logging.error(
                    "Unknown Online Tracker %s, not starting uploader." % _tracker
                )

    elif _habitat_change == "stop":
        online_uploader.close()
        online_uploader = None

    # APRS tracker state is managed by dedicated APRS add/remove events.
    if _old_aprs_enabled and (not _new_aprs_enabled):
        try:
            logging.info("APRS stop requested. Stopping tracker.")
            if aprs_tracker is not None:
                try:
                    aprs_tracker.stop()
                    aprs_tracker.join(timeout=2)
                except Exception as e:
                    logging.error("Error stopping APRS tracker: %s", str(e))
                aprs_tracker = None
        except Exception as e:
            logging.error("Error processing APRS stop request: %s", str(e))
    elif (not _old_aprs_enabled) and _new_aprs_enabled:
        try:
            _calls = chasemapper_config.get("aprs_callsigns", [])
            logging.info("APRS start requested. Callsigns=%s", ", ".join(_calls) if _calls else "none")
            if _calls:
                process_new_aprs_callsigns(_calls)
            else:
                logging.warning("APRS enabled but no callsigns are configured yet.")
        except Exception as e:
            logging.error("Error starting APRS tracker: %s", str(e))

    # Update the habitat uploader with a new update rate, if one has changed.
    if online_uploader != None:
        online_uploader.set_update_rate(chasemapper_config["habitat_update_rate"])
        online_uploader.set_callsign(chasemapper_config["habitat_call"])

    # Push settings back out to all clients.
    flask_emit_event("server_settings_update", chasemapper_config)


@socketio.on("aprs_callsign_add", namespace="/chasemapper")
def aprs_callsign_add(data):
    callsign = _normalize_aprs_callsign(data.get("callsign") if isinstance(data, dict) else None)
    if not callsign:
        return

    changed = _apply_aprs_callsign_add(callsign)
    if not changed:
        return

    logging.info("APRS callsign added on server: %s", callsign)
    flask_emit_event("server_settings_update", chasemapper_config)

    def _bootstrap() -> None:
        try:
            process_new_aprs_callsigns([callsign])
        except Exception as exc:
            logging.error("APRS bootstrap failed for %s: %s", callsign, exc)

    thread = Thread(target=_bootstrap)
    thread.daemon = True
    thread.start()


@socketio.on("aprs_callsign_remove", namespace="/chasemapper")
def aprs_callsign_remove(data):
    callsign = _normalize_aprs_callsign(data.get("callsign") if isinstance(data, dict) else None)
    if not callsign:
        return

    changed = _apply_aprs_callsign_remove(callsign)
    if not changed:
        return

    logging.info("APRS callsign removed on server: %s", callsign)
    _remaining = chasemapper_config.get("aprs_callsigns", [])
    _start_aprs_tracker_for_callsigns(_remaining)
    flask_emit_event("aprs_callsign_removed", {"callsign": callsign})
    flask_emit_event("server_settings_update", chasemapper_config)


@socketio.on("aprs_prediction_override_update", namespace="/chasemapper")
def aprs_prediction_override_update(data):
    if not isinstance(data, dict):
        return

    callsign = _normalize_aprs_callsign(data.get("callsign"))
    if not callsign:
        return

    burst_alt = data.get("pred_burst", None)
    descent_rate = data.get("pred_desc_rate", None)
    overrides = _sanitize_aprs_prediction_overrides(chasemapper_config.get("aprs_prediction_overrides", {}))

    current_defaults = {
        "pred_burst": chasemapper_config.get("pred_burst"),
        "pred_desc_rate": chasemapper_config.get("pred_desc_rate"),
    }

    if burst_alt is None:
        burst_alt = current_defaults["pred_burst"]
    if descent_rate is None:
        descent_rate = current_defaults["pred_desc_rate"]

    if float(burst_alt) == float(current_defaults["pred_burst"]) and float(descent_rate) == float(current_defaults["pred_desc_rate"]):
        if callsign in overrides:
            del overrides[callsign]
    else:
        overrides[callsign] = {
            "pred_burst": float(burst_alt),
            "pred_desc_rate": float(descent_rate),
        }

    chasemapper_config["aprs_prediction_overrides"] = overrides
    _save_aprs_prediction_overrides()
    logging.info("APRS prediction override updated on server for %s", callsign)
    trigger_prediction_async("APRS prediction overrides updated")
    flask_emit_event("server_settings_update", chasemapper_config)


@socketio.on('client_request_prediction', namespace='/chasemapper')
def client_request_prediction(data):
    try:
        _cs = data.get('callsign') if isinstance(data, dict) else None
    except Exception:
        _cs = None
    logging.info('Client requested immediate prediction for %s', _cs or 'ALL')
    trigger_prediction_async('client requested prediction')


def handle_new_payload_position(data, log_position=True):

    def _normalize_telemetry_time(value):
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return pytz.utc.localize(value)
            return value.astimezone(pytz.utc)
        return datetime.now(timezone.utc)

    def _safe_finite(value, default=0.0):
        try:
            parsed = float(value)
            if math.isfinite(parsed):
                return parsed
        except Exception:
            pass
        return default

    _lat = _safe_finite(data.get("lat"), float("nan"))
    _lon = _safe_finite(data.get("lon"), float("nan"))
    _alt = _safe_finite(data.get("alt"), 0.0)
    _time_dt = _normalize_telemetry_time(data.get("time_dt"))
    _callsign = data["callsign"]

    if not (math.isfinite(_lat) and math.isfinite(_lon)):
        logging.warning("Dropping payload position update with non-finite lat/lon for %s", _callsign)
        return

    _short_time = _time_dt.strftime("%H:%M:%S")

    # Ensure payload entries exist; protect creation with lock to avoid races.
    with payloads_lock:
        if _callsign not in current_payloads:
            # New callsign! Create entries in data stores.
            current_payload_tracks[_callsign] = GenericTrack(ascent_averaging=chasemapper_config["ascent_rate_averaging"])

            current_payloads[_callsign] = {
                "telem": {
                    "callsign": _callsign,
                    "position": [_lat, _lon, _alt],
                    "max_alt": 0.0,
                    "vel_v": 0.0,
                    "speed": 0.0,
                    "short_time": _short_time,
                    "packet_time": _time_dt.isoformat(),
                    "time_to_landing": "",
                    "server_time": time.time(),
                },
                "path": [],
                "pred_path": [],
                "pred_landing": [],
                "burst": [],
                "abort_path": [],
                "abort_landing": [],
                "max_alt": 0.0,
                "snr": -255.0,
                "pred_inputs": {},
                "wind_profile": [],
            }

    # Add new data into the payload's track, and get the latest ascent rate.
    # current_payload_tracks is shared with other listener threads (UDP/APRS),
    # so mutate/read it under the same lock used for current_payloads.
    with payloads_lock:
        current_payload_tracks[_callsign].add_telemetry(
            {"time": _time_dt, "lat": _lat, "lon": _lon, "alt": _alt, "comment": _callsign}
        )
        _state = current_payload_tracks[_callsign].get_latest_state()
    _speed = 0.0
    if _state != None:
        _vel_v = _safe_finite(_state.get("ascent_rate"), 0.0)
        _speed = _safe_finite(_state.get("speed"), 0.0)
        # If this payload is in descent, calculate the time to landing.
        # Use < -1.0, to avoid jitter when the payload is on the ground.
        if _vel_v < -1.0:
            # Try and get the altitude of the chase car - we use this as the expected 'ground' level.
            _car_state = car_track.get_latest_state()
            if _car_state != None:
                _ground_asl = _car_state["alt"]
            else:
                _ground_asl = 0.0

            # Calculate
            _ttl = time_to_landing(_alt, _vel_v, ground_asl=_ground_asl)
            if _ttl is None:
                _ttl = ""
            elif _ttl == 0:
                _ttl = "LANDED"
            else:
                _min = _ttl // 60
                _sec = _ttl % 60
                _ttl = "%02d:%02d" % (_min, _sec)
        else:
            _ttl = ""

    else:
        _vel_v = 0.0
        _ttl = ""

    # Now update the main telemetry store. Do writes under lock to avoid races.
    with payloads_lock:
        current_payloads[_callsign]["telem"] = {
            "callsign": _callsign,
            "position": [_lat, _lon, _alt],
            "vel_v": _vel_v,
            "speed": _safe_finite(_speed, 0.0),
            "short_time": _short_time,
            "packet_time": _time_dt.isoformat(),
            "time_to_landing": _ttl,
            "server_time": time.time(),
        }

        _path = current_payloads[_callsign]["path"]
        _path.append([_lat, _lon, _alt])
        if len(_path) > MAX_TELEMETRY_PATH_POINTS:
            del _path[: len(_path) - MAX_TELEMETRY_PATH_POINTS]

    # Copy out any extra fields we may want to pass onto the GUI.
    with payloads_lock:
        for _field in EXTRA_FIELDS:
            if _field in data:
                current_payloads[_callsign]["telem"][_field] = data[_field]

    # Check if the current payload altitude is higher than our previous maximum altitude.
    with payloads_lock:
        if _alt > current_payloads[_callsign]["max_alt"]:
            current_payloads[_callsign]["max_alt"] = _alt

        # Add the payload maximum altitude into the telemetry snapshot dictionary.
        current_payloads[_callsign]["telem"]["max_alt"] = current_payloads[_callsign]["max_alt"]

    # Update the web client.
    flask_emit_event("telemetry_event", current_payloads[_callsign]["telem"])

    # Add the position into the logger
    if chase_logger and log_position:
        chase_logger.add_balloon_telemetry(data)
    else:
        logging.debug("Point not logged.")

    # Trigger immediate prediction bootstrap for new payloads or small tracks
    # (unless this is APRS bootstrap data, which gets special handling)
    if not data.get("aprs_bootstrap", False):
        with payloads_lock:
            _track_len = current_payload_tracks[_callsign].length()
        if _track_len > 0 and _track_len <= 2:
            trigger_prediction_async("Bootstrap prediction for %s" % _callsign)

def handle_modem_stats(data):
    """ Basic handling of modem statistics data. If it matches a known payload, send the info to the client. """

    with payloads_lock:
        exists = data["source"] in current_payloads

    if exists:
        flask_emit_event(
            "modem_stats_event", {"callsign": data["source"], "snr": data["snr"]}
        )


#
#   Predictor Code
#
predictor = None
# Set (idle) when no prediction is running, cleared while run_prediction() is
# executing. Callers that need to wait for the predictor to be idle (e.g.
# before restarting/stopping it) block on predictor_idle_event.wait(timeout=...)
# instead of polling in a sleep loop. A timeout is used so a caller can't hang
# forever if a prediction run never completes.
predictor_idle_event = Event()
predictor_idle_event.set()

predictor_thread_running = True
predictor_thread = None


def predictorThread():
    """ Run the predictor on a regular interval """
    global predictor_thread_running, chasemapper_config
    logging.info("Predictor loop started.")

    while predictor_thread_running:
        try:
            run_prediction()
        except Exception:
            logging.exception("Predictor loop iteration failed - will retry on next cycle.")
        # Use more efficient sleep instead of loop over 1-second intervals
        update_rate = int(chasemapper_config.get("pred_update_rate", 15))
        for _ in range(update_rate):
            if not predictor_thread_running:
                break
            time.sleep(1)

    logging.info("Closed predictor loop.")


def run_prediction():
    """ Run a Flight Path prediction """
    global chasemapper_config, current_payloads, current_payload_tracks, predictor

    if chasemapper_config["pred_enabled"] == False:
        return

    if (chasemapper_config["offline_predictions"] == True) and (predictor == None):
        return

    # Clear the idle event so we don't accidentally kill the predictor object while it's running.
    predictor_idle_event.clear()
    try:
        with payloads_lock:
            _payload_list = list(current_payload_tracks.keys())
        for _payload in _payload_list:

            # Check the age of the data.
            # If data is slightly stale allow Tawhiri to run by forcing the launch time to now,
            # otherwise skip as before.
            with payloads_lock:
                _entry = current_payloads.get(_payload)
            if not _entry:
                logging.warning("Missing telemetry for %s, skipping prediction.", _payload)
                continue
            _telem = _entry.get("telem") if isinstance(_entry, dict) else None
            if not _telem:
                logging.warning("Missing telemetry for %s, skipping prediction.", _payload)
                continue
            _pos_age = time.time() - float(_telem.get("server_time", time.time()))
            if _pos_age > 30.0:
                if predictor == "Tawhiri":
                    logging.info("Telemetry for %s is stale (%.1fs); forcing Tawhiri prediction using latest beacon state with current time.", _payload, _pos_age)
                    # Force the launch time to now so Tawhiri doesn't compute negative hours
                    # and continue using the latest known state for position/altitude.
                    # We'll set the _current_pos time when calling the predictor below.
                    pass
                else:
                    logging.debug("Skipping prediction for %s due to old data.", _payload)
                    continue

            with payloads_lock:
                _track = current_payload_tracks.get(_payload)
            if _track is None:
                logging.warning("No track for %s, skipping prediction.", _payload)
                continue

            _current_pos = _track.get_latest_state()
            if _current_pos is None:
                logging.warning("No current state available for %s, skipping prediction.", _payload)
                continue

            _current_pos_list = [
                0,
                _current_pos["lat"],
                _current_pos["lon"],
                _current_pos["alt"],
            ]
            _track_len = _track.length()
            if _track_len <= 1:
                _aprs_calls = set([c.upper() for c in chasemapper_config.get("aprs_callsigns", []) if c])
                if _payload.upper() in _aprs_calls:
                    logging.info("APRS bootstrap prediction for %s with a single telemetry point.", _payload)
                else:
                    logging.info("Only %i point in payload %s's track, skipping prediction.", _track_len, _payload)
                    continue

            _pred_ok = False
            _abort_pred_ok = False

            _burst_threshold = chasemapper_config["pred_burst"]
            _call_overrides = chasemapper_config.get("aprs_prediction_overrides", {})
            if isinstance(_call_overrides, dict):
                _override = _call_overrides.get(_payload.upper(), {})
                if isinstance(_override, dict):
                    _override_burst = _override.get("pred_burst")
                    if _override_burst is not None:
                        try:
                            _override_burst = float(_override_burst)
                            if math.isfinite(_override_burst):
                                _burst_threshold = _override_burst
                        except Exception:
                            pass

            if _current_pos["is_descending"]:
                _desc_rate = _current_pos["landing_rate"]
            else:
                _desc_rate = chasemapper_config["pred_desc_rate"]

                if isinstance(_call_overrides, dict):
                    _override = _call_overrides.get(_payload.upper(), {})
                    if isinstance(_override, dict):
                        _override_desc = _override.get("pred_desc_rate")
                        if _override_desc is not None:
                            try:
                                _override_desc = float(_override_desc)
                                if math.isfinite(_override_desc):
                                    _desc_rate = _override_desc
                            except Exception:
                                pass

            if _current_pos["alt"] > _burst_threshold:
                _burst_alt = _current_pos["alt"] + 100
            else:
                _burst_alt = _burst_threshold

            if predictor == "Tawhiri":
                logging.info("Requesting Prediction from Tawhiri for %s.", _payload)
                # Tawhiri requires that the burst altitude always be higher than the starting altitude.
                if _current_pos["is_descending"]:
                    _burst_alt = _current_pos["alt"] + 1

                # Tawhiri requires that the ascent rate be > 0 for standard profiles.
                if _current_pos["ascent_rate"] < 0.1:
                    _current_pos["ascent_rate"] = 0.1
                # If telemetry is stale, override launch time to now to avoid invalid hour computations
                if _pos_age > 30.0:
                    # Use a timezone-aware UTC datetime for Tawhiri (API expects RFC3339).
                    _current_pos["time"] = datetime.now(timezone.utc)

                # Defensive logging of parameters passed to Tawhiri to assist debugging dataset/hour errors.
                try:
                    logging.info("Tawhiri params: callsign=%s time=%s type=%s lat=%.5f lon=%.5f alt=%.1f ascent=%.2f desc=%.2f burst=%.1f pos_age=%.1f",
                                  _payload, getattr(_current_pos["time"], "isoformat", lambda: str(_current_pos["time"]))(), type(_current_pos["time"]).__name__,
                                  _current_pos["lat"], _current_pos["lon"], _current_pos["alt"], _current_pos["ascent_rate"], _desc_rate, _burst_alt, _pos_age)
                except Exception:
                    logging.info("Tawhiri params: (could not format parameters)")

                _tawhiri = get_tawhiri_prediction(
                    launch_datetime=_current_pos["time"],
                    launch_latitude=_current_pos["lat"],
                    launch_longitude=_current_pos["lon"],
                    launch_altitude=_current_pos["alt"],
                    burst_altitude=_burst_alt,
                    ascent_rate=_current_pos["ascent_rate"],
                    descent_rate=_desc_rate,
                )

                if _tawhiri:
                    _pred_path = _tawhiri["path"]
                    _dataset = _tawhiri["dataset"]
                    _dataset_time = None
                    try:
                        _dataset_time = datetime.strptime(_dataset, "%Y%m%d%Hz")
                    except Exception:
                        _dataset_time = None
                    _model_label = _dataset + " (Online)"
                    _emit_predictor_model_status(_model_label, _dataset_time)

                else:
                    # Tawhiri failed — create a simple fallback prediction using current state.
                    try:
                        logging.info("Tawhiri returned no data for %s, using simple fallback predictor.", _payload)
                        # Estimate time to landing using descent rate and current altitude.
                        _ttl = time_to_landing(_current_pos["alt"], -1.0 * abs(_desc_rate), ground_asl=0.0)
                        if _ttl is None or _ttl == 0:
                            _pred_path = []
                        else:
                            # Project landing position using current speed and heading.
                            _speed = float(_current_pos.get("speed", 0.0) or 0.0)
                            _heading = float(_current_pos.get("heading", 0.0) or 0.0)
                            _distance = _speed * float(_ttl)
                            # Earth radius used in earthmaths.py
                            _radius = 6364963.0
                            from math import radians, degrees, sin, cos, atan2, asin

                            lat1 = radians(_current_pos["lat"])
                            lon1 = radians(_current_pos["lon"])
                            bearing = radians(_heading)
                            d_r = _distance / _radius

                            lat2 = asin(sin(lat1) * cos(d_r) + cos(lat1) * sin(d_r) * cos(bearing))
                            lon2 = lon1 + atan2(sin(bearing) * sin(d_r) * cos(lat1), cos(d_r) - sin(lat1) * sin(lat2))

                            lat2 = degrees(lat2)
                            lon2 = degrees(lon2)

                            # Create a minimal path: start (current) and landing point at alt=0
                            _pred_path = [
                                [int(time.time()), _current_pos["lat"], _current_pos["lon"], _current_pos["alt"]],
                                [int(time.time() + _ttl), lat2, lon2, 0.0],
                            ]
                    except Exception:
                        logging.error("Fallback prediction failed for %s: %s", _payload, traceback.format_exc())
                        _pred_path = []

            else:
                logging.info("Running Offline Predictor for %s.", _payload)
                _pred_path = predictor.predict(
                    launch_lat=_current_pos["lat"],
                    launch_lon=_current_pos["lon"],
                    launch_alt=_current_pos["alt"],
                    ascent_rate=_current_pos["ascent_rate"],
                    descent_rate=_desc_rate,
                    burst_alt=_burst_alt,
                    launch_time=_current_pos["time"],
                    descent_mode=_current_pos["is_descending"],
                )

            # Snapshot of the settings actually used for this prediction, and (if running
            # the offline predictor) the wind data that drove it. Wind data is only
            # available locally - Tawhiri does not expose it. Both are display-only and
            # must never be allowed to break the prediction itself.
            _pred_inputs = {
                "ascent_rate": _current_pos["ascent_rate"],
                "descent_rate": _desc_rate,
                "burst_altitude": _burst_alt,
                "launch_lat": _current_pos["lat"],
                "launch_lon": _current_pos["lon"],
                "launch_time": _current_pos["time"].isoformat() if hasattr(_current_pos["time"], "isoformat") else str(_current_pos["time"]),
            }

            _wind_profile = []
            if predictor != "Tawhiri":
                try:
                    _wind_profile = get_wind_profile(
                        pred_settings["gfs_path"],
                        _current_pos["lat"],
                        _current_pos["lon"],
                        _current_pos["time"],
                    )
                except Exception:
                    logging.error("Error fetching wind profile for %s: %s", _payload, traceback.format_exc())
                    _wind_profile = []

            if len(_pred_path) > 1:
                # Valid Prediction!
                _pred_path.insert(0, _current_pos_list)
                # Convert from predictor output format to a polyline.
                _pred_output = []
                for _point in _pred_path:
                    _pred_output.append([_point[1], _point[2], _point[3]])

                # Store prediction outputs under lock to avoid races with other threads.
                with payloads_lock:
                    current_payloads[_payload]["pred_path"] = _pred_output
                    current_payloads[_payload]["pred_landing"] = _pred_output[-1]
                    current_payloads[_payload]["pred_inputs"] = _pred_inputs
                    current_payloads[_payload]["wind_profile"] = _wind_profile

                    if _current_pos["is_descending"]:
                        current_payloads[_payload]["burst"] = []
                    else:
                        # Determine the burst position.
                        _cur_alt = 0.0
                        _cur_idx = 0
                        for i in range(len(_pred_output)):
                            if _pred_output[i][2] > _cur_alt:
                                _cur_alt = _pred_output[i][2]
                                _cur_idx = i

                        current_payloads[_payload]["burst"] = _pred_output[_cur_idx]

                _pred_ok = True
                logging.info("Prediction Updated, %d data points." % len(_pred_path))
            else:
                with payloads_lock:
                    current_payloads[_payload]["pred_path"] = []
                    current_payloads[_payload]["pred_landing"] = []
                    current_payloads[_payload]["burst"] = []
                logging.error("Prediction Failed, possible invalid or missing dataset.")
                flask_emit_event("predictor_model_update", {"model": "Dataset invalid."})

            # Abort predictions
            if (
                chasemapper_config["show_abort"]
                and (_current_pos["alt"] < _burst_threshold)
                and (_current_pos["is_descending"] == False)
            ):

                if predictor == "Tawhiri":
                    logging.info(
                        "Requesting Abort Prediction from Tawhiri for %s." % _payload
                    )

                    # Tawhiri requires that the ascent rate be > 0 for standard profiles.
                    if _current_pos["ascent_rate"] < 0.1:
                        _current_pos["ascent_rate"] = 0.1

                    _tawhiri = get_tawhiri_prediction(
                        launch_datetime=_current_pos["time"],
                        launch_latitude=_current_pos["lat"],
                        launch_longitude=_current_pos["lon"],
                        launch_altitude=_current_pos["alt"],
                        burst_altitude=_current_pos["alt"] + 200,
                        ascent_rate=_current_pos["ascent_rate"],
                        descent_rate=_desc_rate,
                    )

                    if _tawhiri:
                        _abort_pred_path = _tawhiri["path"]

                    else:
                        _abort_pred_path = []

                else:
                    logging.info("Running Offline Abort Predictor for: %s.", _payload)

                    _abort_pred_path = predictor.predict(
                        launch_lat=_current_pos["lat"],
                        launch_lon=_current_pos["lon"],
                        launch_alt=_current_pos["alt"],
                        ascent_rate=_current_pos["ascent_rate"],
                        descent_rate=_desc_rate,
                        burst_alt=_current_pos["alt"] + 200,
                        launch_time=_current_pos["time"],
                        descent_mode=_current_pos["is_descending"],
                    )

                if len(_abort_pred_path) > 1:
                    # Valid Prediction!
                    _abort_pred_path.insert(0, _current_pos_list)
                    # Convert from predictor output format to a polyline.
                    _abort_pred_output = []
                    for _point in _abort_pred_path:
                        _abort_pred_output.append([_point[1], _point[2], _point[3]])

                    current_payloads[_payload]["abort_path"] = _abort_pred_output
                    current_payloads[_payload]["abort_landing"] = _abort_pred_output[-1]

                    _abort_pred_ok = True
                    logging.info(
                        "Abort Prediction Updated, %d data points." % len(_abort_pred_path)
                    )
                else:
                    current_payloads[_payload]["abort_path"] = []
                    current_payloads[_payload]["abort_landing"] = []
                    logging.error("Prediction Failed, possible invalid or missing dataset.")
                    flask_emit_event("predictor_model_update", {"model": "Dataset invalid."})
            else:
                # Zero the abort path and landing
                current_payloads[_payload]["abort_path"] = []
                current_payloads[_payload]["abort_landing"] = []

            # Send the web client the updated prediction data.
            if _pred_ok or _abort_pred_ok:
                _client_data = {
                    "callsign": _payload,
                    "pred_path": current_payloads[_payload]["pred_path"],
                    "pred_landing": current_payloads[_payload]["pred_landing"],
                    "burst": current_payloads[_payload]["burst"],
                    "abort_path": current_payloads[_payload]["abort_path"],
                    "abort_landing": current_payloads[_payload]["abort_landing"],
                    "pred_inputs": current_payloads[_payload]["pred_inputs"],
                    "wind_profile": current_payloads[_payload]["wind_profile"],
                }
                flask_emit_event("predictor_update", _client_data)

                # Add the prediction run to the logger.
                if chase_logger:
                    chase_logger.add_balloon_prediction(_client_data)

    finally:
        # Mark the predictor idle again.
        predictor_idle_event.set()


def initPredictor():
    global predictor, predictor_thread, chasemapper_config, pred_settings

    if chasemapper_config["offline_predictions"]:
        # Attempt to initialize an Offline Predictor instance
        try:
            from cusfpredict.predict import Predictor
            from cusfpredict.utils import gfs_model_age, available_gfs

            # Check if we have any GFS data
            _model_age = gfs_model_age(pred_settings["gfs_path"])
            if _model_age == "Unknown":
                logging.error("No GFS data in directory.")
                _emit_predictor_model_status("No GFS Data.")
                chasemapper_config["offline_predictions"] = False
            else:
                # Check model contains data to at least 4 hours into the future.
                (_model_start, _model_end) = available_gfs(pred_settings["gfs_path"])
                _model_now = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(0, 60 * 60 * 4)
                if (_model_now < _model_start) or (_model_now > _model_end):
                    # No suitable GFS data!
                    logging.error("GFS Data in directory does not cover now!")
                    _emit_predictor_model_status("Old GFS Data.", _model_start)
                    chasemapper_config["offline_predictions"] = False

                else:
                    _emit_predictor_model_status(_model_age + " (Offline)", _model_start)
                    predictor = Predictor(
                        bin_path=pred_settings["pred_binary"],
                        gfs_path=pred_settings["gfs_path"],
                    )

                    # Start up the predictor thread if it is not running.
                    if predictor_thread == None:
                        predictor_thread = Thread(target=predictorThread, daemon=True)
                        predictor_thread.start()

                    # Set the predictor to enabled, and update the clients.
                    chasemapper_config["offline_predictions"] = True

        except Exception as e:
            traceback.print_exc()
            logging.error("Loading predictor failed: " + str(e))
            _emit_predictor_model_status("Failed - Check Log.")
            print("Loading Predictor failed.")
            predictor = None

    else:
        # No initialization required for the online predictor
        predictor = "Tawhiri"
        _emit_predictor_model_status("Tawhiri")

        # Start up the predictor thread if it is not running.
        if predictor_thread == None:
            predictor_thread = Thread(target=predictorThread, daemon=True)
            predictor_thread.start()

    flask_emit_event("server_settings_update", chasemapper_config)


def model_download_finished(result):
    """ Callback for when the model download is finished """
    global chasemapper_config
    if result == "OK":
        # Downloader reported OK, restart the predictor.
        chasemapper_config["offline_predictions"] = True
        initPredictor()
    else:
        # Downloader reported an error, pass on to the client.
        flask_emit_event("predictor_model_update", {"model": result})


@socketio.on("download_model", namespace="/chasemapper")
def download_new_model(data):
    """ Trigger a download of a new weather model """
    global pred_settings, model_download_running
    # Don't action anything if there is a model download already running

    logging.info("Web Client Initiated request for new predictor data.")

    if pred_settings["pred_model_download"] == "none":
        logging.info("No GFS model download command specified.")
        flask_emit_event("predictor_model_update", {"model": "No model download cmd."})
        return
    else:
        _model_cmd = pred_settings["pred_model_download"]
        flask_emit_event("predictor_model_update", {"model": "Downloading Model."})

        _status = predictor_spawn_download(_model_cmd, model_download_finished)
        flask_emit_event("predictor_model_update", {"model": _status})


@app.route("/download_model")
def download_new_model_2():
    """ Trigger a download of a new weather model via a GET request """
    global pred_settings, model_download_running

    logging.info("Web Client Initiated request for new predictor data via /download_model.")

    if pred_settings["pred_model_download"] == "none":
        logging.info("No GFS model download command specified.")
        return "No model download cmd."
    else:
        _model_cmd = pred_settings["pred_model_download"]
        _status = predictor_spawn_download(_model_cmd, model_download_finished)
        return _status


# Data Clearing Functions
@socketio.on("payload_data_clear", namespace="/chasemapper")
def clear_payload_data(data):
    """ Clear the payload data store """
    global current_payloads, current_payload_tracks
    if not _require_operator_auth():
        _deny_operator_action("payload_data_clear")
        return
    logging.warning("Client requested all payload data be cleared.")
    # Wait until any current prediction has finished running.
    predictor_idle_event.wait(timeout=10.0)

    # Clear the existing dicts under lock to avoid races with other threads.
    with payloads_lock:
        current_payloads.clear()
        current_payload_tracks.clear()


@socketio.on("car_data_clear", namespace="/chasemapper")
def clear_car_data(data):
    """ Clear out the car position track """
    global car_track
    if not _require_operator_auth():
        _deny_operator_action("car_data_clear")
        return
    logging.warning("Client requested all chase car data be cleared.")
    car_track = GenericTrack()


@socketio.on("bearing_store_clear", namespace="/chasemapper")
def clear_bearing_data(data):
    """ Clear all bearing data """
    global bearing_store
    logging.warning("Client requested bearing data be cleared.")
    bearing_store.flush()
    flask_emit_event("server_bearings_cleared", {"foo":"bar"})


@socketio.on("bearing_source_clear", namespace="/chasemapper")
def clear_bearing_source(data):
    """ Clear bearing data from a single source, leaving other sources
    intact. Not operator-gated, matching bearing_store_clear above - bearing
    data isn't considered as sensitive/high-stakes to clear as payload or
    car position data. """
    global bearing_store
    if not isinstance(data, dict) or not data.get("source"):
        return
    logging.warning("Client requested bearing data from source '%s' be cleared." % data["source"])
    bearing_store.remove_source(data["source"])


@socketio.on("mark_recovered", namespace="/chasemapper")
def mark_payload_recovered(data):
    """ Mark a payload as recovered, by uploading a station position """
    global online_uploader

    print(data)

    _serial = data["payload_call"]
    _callsign = data["my_call"]
    _lat = data["last_pos"][0]
    _lon = data["last_pos"][1]
    _alt = data["last_pos"][2]
    _msg = data["message"]
    _recovered = data["recovered"]

    if online_uploader != None:
        online_uploader.mark_payload_recovered(
            serial = _serial,
            callsign = _callsign,
            lat = _lat, 
            lon = _lon, 
            alt = _alt, 
            message = _msg, 
            recovered=_recovered
            )
    else:
        logging.error("No Online Tracker enabled, could not mark payload as recovered.")


# Incoming telemetry handlers


def ozi_listener_callback(data):
    """ Handle a OziMux input message """
    # OziMux message contains:
    # {'lat': -34.87915, 'comment': 'Telemetry Data', 'alt': 26493.0, 'lon': 139.11883, 'time': datetime.datetime(2018, 7, 16, 10, 55, 49, tzinfo=tzutc())}
    output = {}
    output["lat"] = float(data["lat"])
    output["lon"] = float(data["lon"])
    output["alt"] = float(data["alt"])
    output["callsign"] = "Payload"
    output["time_dt"] = data["time"]

    logging.info(
        "OziMux Data: %.5f, %.5f, %.1f" % (data["lat"], data["lon"], data["alt"])
    )

    try:
        handle_new_payload_position(output)
    except Exception as e:
        logging.error("Error Handling Payload Position - %s" % str(e))


def aprs_listener_callback(data):
    """ Handle an APRS-provided position and adapt it to the internal handler.

    The APRS tracker provides a dict with keys: lat, lon, alt, callsign, and
    optionally time_dt. Ensure time_dt exists and pass through to the same
    handler used by other listeners.
    """
    try:
        if "time_dt" not in data:
            data["time_dt"] = datetime.now(timezone.utc)

        logging.info(
            "APRS position update: %s lat=%.5f lon=%.5f alt=%.1f"
            % (
                data.get("callsign", "UNKNOWN"),
                float(data.get("lat", 0.0)),
                float(data.get("lon", 0.0)),
                float(data.get("alt", 0.0)),
            )
        )

        handle_new_payload_position(data)
    except Exception as e:
        logging.error("Error Handling APRS Position - %s" % str(e))


def trigger_prediction_async(reason="manual trigger"):
    """Run one prediction cycle in a background thread."""

    def _run_once():
        try:
            if not predictor_idle_event.is_set():
                logging.info("Skipping immediate prediction (%s): predictor is busy.", reason)
                return
            logging.info("Running immediate prediction (%s).", reason)
            run_prediction()
        except Exception as e:
            logging.error("Immediate prediction failed (%s): %s", reason, str(e))

    _t = Thread(target=_run_once)
    _t.daemon = True
    _t.start()

def start_or_restart_aprs_tracker(callsigns):
    """Start the APRS tracker, or restart it so live filters include new callsigns."""
    global aprs_tracker, chasemapper_config

    _calls = list(callsigns or [])
    if not _calls:
        logging.warning("APRS tracker start requested with no callsigns.")
        return

    logging.info("(Re)starting APRS tracker for callsigns: %s", ", ".join(_calls))

    if aprs_tracker is not None:
        try:
            aprs_tracker.stop()
            aprs_tracker.join(timeout=2)
        except Exception:
            pass
        aprs_tracker = None

    aprs_tracker = APRSTracker(
        callsigns=_calls,
        poll_interval=chasemapper_config.get("aprs_poll_interval", 30),
        callback=aprs_listener_callback,
                            api_key=get_effective_aprs_api_key(),
    )
    aprs_tracker.daemon = True
    aprs_tracker.start()


def process_new_aprs_callsigns(callsigns, restart_tracker=True):
    """Fetch the latest beacon for newly added callsigns, then ensure live tracking."""
    _calls = []
    for _cs in callsigns or []:
        if _cs and _cs not in _calls:
            _calls.append(_cs)

    if not _calls:
        logging.warning("No APRS callsigns provided for initial data fetch.")
        return False

    _have_initial_data = False
    _api_key = get_effective_aprs_api_key()
    for _cs in _calls:
        try:
            logging.info("APRS initial fetch requested for %s" % _cs)
            _data_points = fetch_aprs_recent_points(_cs, api_key=_api_key, limit=2)
            if _data_points:
                if len(_data_points) == 1:
                    logging.info("APRS: using most recent beacon for %s" % _cs)
                else:
                    logging.info("APRS: using %d most recent beacons for %s" % (len(_data_points), _cs))
                for _data in _data_points:
                    _data["aprs_bootstrap"] = True
                    aprs_listener_callback(_data)
                _have_initial_data = True
            else:
                logging.warning("APRS initial fetch returned no data for %s" % _cs)
        except Exception as e:
            logging.error("Error fetching initial APRS beacon for %s: %s" % (_cs, str(e)))

    if restart_tracker:
        start_or_restart_aprs_tracker(chasemapper_config.get("aprs_callsigns", _calls))

    if _have_initial_data:
        trigger_prediction_async("APRS initial fetch")

    return _have_initial_data


def fetch_aprs_recent(callsign, api_key=None):
    """Fetch the most recent APRS position for `callsign` from aprs.fi.

    Returns a dict with keys lat, lon, alt, callsign and optionally time_dt,
    or None on failure.
    """
    _points = fetch_aprs_recent_points(callsign, api_key=api_key, limit=1)
    if not _points:
        return None
    return _points[0]


def fetch_aprs_recent_points(callsign, api_key=None, limit=2):
    """Fetch the most recent APRS positions for `callsign` from aprs.fi.

    Returns a list of dicts ordered oldest-to-newest, each with keys lat, lon,
    alt, callsign and optionally time_dt.
    """
    try:
        logging.info("APRS request: latest position for %s", callsign)
        params = {"name": callsign, "what": "loc", "format": "json"}
        if not api_key:
            logging.warning(
                "APRS initial fetch for %s skipped: aprs.fi API key is not configured." % callsign
            )
            return None
        if api_key:
            params["apikey"] = api_key
        resp = requests.get("https://api.aprs.fi/api/get", params=params, timeout=10)
        if resp.status_code != 200:
            logging.warning("APRS request failed for %s: HTTP %s" % (callsign, resp.status_code))
            return None
        try:
            j = resp.json()
        except Exception as e:
            logging.warning(
                "APRS request returned non-JSON for %s: %s body=%s"
                % (callsign, str(e), resp.text[:180])
            )
            return None

        entries = []
        if isinstance(j, dict):
            _entries = j.get("entries", [])
            if isinstance(_entries, list):
                entries = _entries

            if not entries:
                _result = j.get("result")
                if isinstance(_result, list):
                    entries = _result
                elif isinstance(_result, str) and _result.lower() != "ok":
                    _desc = j.get("description") or j.get("error") or "no description"
                    logging.warning(
                        "APRS request not OK for %s: result=%s description=%s"
                        % (callsign, _result, _desc)
                    )
        elif isinstance(j, list):
            entries = j
        else:
            logging.warning(
                "APRS request returned unexpected payload for %s: type=%s body=%s"
                % (callsign, type(j).__name__, str(j)[:180])
            )
            return None

        if not entries:
            logging.warning("APRS request returned no entries for %s" % callsign)
            return None
        _selected_entries = entries[:max(1, int(limit))]
        _selected_entries.reverse()

        _points = []
        for entry in _selected_entries:
            lat = entry.get("lat") or entry.get("latitude") or None
            lon = entry.get("lng") or entry.get("lon") or entry.get("longitude") or None
            alt = entry.get("alt") or entry.get("altitude") or 0
            time_str = entry.get("time") or entry.get("timestamp") or entry.get("time_iso")
            if lat is None or lon is None:
                continue
            try:
                lat = float(lat)
                lon = float(lon)
            except Exception:
                continue
            try:
                alt = float(alt)
            except Exception:
                alt = 0.0

            out = {"lat": lat, "lon": lon, "alt": alt, "callsign": callsign}
            if time_str is not None:
                try:
                    if isinstance(time_str, (int, float)) or (isinstance(time_str, str) and time_str.isdigit()):
                        out["time_dt"] = parse_dt(time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(int(time_str))))
                    else:
                        out["time_dt"] = parse_dt(time_str)
                except Exception:
                    pass
            _points.append(out)

        if not _points:
            logging.warning("APRS request returned no usable points for %s" % callsign)
            return None

        logging.info("APRS request succeeded for %s" % callsign)
        return _points
    except Exception as e:
        logging.error("APRS request exception for %s: %s" % (callsign, str(e)))
        return None


def ensure_aprs_initial_data(callsign, timeout=60):
    """Wait up to `timeout` seconds for the callsign to appear in `current_payloads`.

    If not seen, fetch the most recent APRS beacon and inject it via
    `aprs_listener_callback` so predictions can run.
    """
    start = time.time()
    key_upper = callsign.upper()
    logging.info("Waiting up to %ss for first APRS telemetry for %s" % (timeout, callsign))
    while time.time() - start < timeout:
        # Check for existing payload (case-insensitive)
        for existing in list(current_payloads.keys()):
            if existing.upper() == key_upper:
                logging.info("APRS initial telemetry already present for %s" % callsign)
                return
        time.sleep(5)

    # Not found within timeout — attempt to fetch from aprs.fi
    try:
        api_key = get_effective_aprs_api_key()
        data_points = fetch_aprs_recent_points(callsign, api_key=api_key, limit=2)
        if data_points:
            if len(data_points) == 1:
                logging.info("APRS: injecting fetched recent beacon for %s" % callsign)
            else:
                logging.info("APRS: injecting %d fetched recent beacons for %s" % (len(data_points), callsign))
            for data in data_points:
                data["aprs_bootstrap"] = True
                aprs_listener_callback(data)
        else:
            logging.warning("APRS initial telemetry fetch timed out with no data for %s" % callsign)
    except Exception as e:
        logging.error("Error ensuring APRS initial data for %s: %s" % (callsign, str(e)))


def get_effective_aprs_api_key():
    """Return APRS API key or None if unset/placeholder."""
    if not isinstance(chasemapper_config, dict):
        return None

    _key = chasemapper_config.get("aprs_api_key", None)
    if _key is None:
        return None

    _key = str(_key).strip()
    if _key == "" or _key.lower() in ["none", "null", "unset"]:
        return None

    return _key
    
def udp_listener_summary_callback(data):
    """ Handle a Payload Summary Message from UDPListener """

    # Modem stats messages are also passed in via this callback.
    # handle them separately.

    # Extract the fields we need.
    # Convert to something generic we can pass onwards.
    output = {}
    output["lat"] = float(data["latitude"])
    output["lon"] = float(data["longitude"])
    output["alt"] = float(data["altitude"])
    output["callsign"] = data["callsign"]

    if "time" in data.keys():
        _time = data["time"]
    else:
        _time = "??:??:??"

    logging.info(
        "Horus UDP Data: %s, %s, %.5f, %.5f, %.1f"
        % (output["callsign"], _time, output["lat"], output["lon"], output["alt"])
    )

    # Process the 'short time' value if we have been provided it.
    if "time" in data.keys():
        output["time_dt"] = fix_datetime(data["time"])
        # _full_time = datetime.utcnow().strftime("%Y-%m-%dT") + data['time'] + "Z"
        # output['time_dt'] = parse(_full_time)
    else:
        # Otherwise use the current UTC time.

        output["time_dt"] = datetime.now(timezone.utc)

    # Copy out any extra fields that we want to pass on to the GUI.
    for _field in EXTRA_FIELDS:
        if _field in data:
            output[_field] = data[_field]

    try:
        handle_new_payload_position(output)
    except Exception as e:
        logging.error("Error Handling Payload Position - %s" % str(e))


def udp_listener_car_callback(data):
    """ Handle car position data """
    # TODO: Make a generic car position function, and have this function pass data into it
    # so we can add support for other chase car position inputs.
    global car_track, online_uploader, bearing_store
    _lat = float(data["latitude"])
    _lon = float(data["longitude"])

    # Handle when GPSD and/or other GPS data sources return a n/a for altitude.
    try:
        _alt = float(data["altitude"])
    except Exception:
        _alt = 0.0

    _comment = "CAR"
    _time_dt = datetime.now(timezone.utc)

    logging.debug("Car Position: %.5f, %.5f" % (_lat, _lon))

    _car_position_update = {
        "time": _time_dt,
        "lat": _lat,
        "lon": _lon,
        "alt": _alt,
        "comment": _comment,
    }
    # Add in true heading data if we have been supplied it (e.g. from a uBlox NEO-M8U device)
    if "heading" in data:
        _car_position_update["heading"] = data["heading"]

    if "heading_status" in data:
        _car_position_update["heading_status"] = data["heading_status"]
    

    car_track.add_telemetry(_car_position_update)

    _state = car_track.get_latest_state()
    _heading = _state["heading"]
    _heading_status = _state["heading_status"]
    _heading_valid = _state["heading_valid"]
    _speed = _state["speed"]


    _car_telem = {
            "callsign": "CAR",
            "position": [_lat, _lon, _alt],
            "vel_v": 0.0,
            "heading": _heading,
            "heading_valid": _heading_valid,
            "heading_status": _heading_status,
            "speed": _speed,
    }

    if 'replay_time' in data:
        # We are getting data from a log file replay, make sure to pass this on
        _replay_time = parse(data['replay_time'])
        _replay_time_str = _replay_time.strftime("%Y-%m-%d %H:%M:%SZ")
        _car_telem['replay_time'] = _replay_time_str

    # Add in some additional status fields if we have them.
    if 'numSV' in data:
        _car_telem['numSV'] = data['numSV']

    # Push the new car position to the web client
    flask_emit_event(
        "telemetry_event",
        _car_telem
    )

    # Update the Online Position Uploader, if one exists.
    if online_uploader != None:
        online_uploader.update_position(data)

    # Update the bearing store with the current car state (position & bearing)
    if bearing_store != None:
        bearing_store.update_car_position(_state)

    # Add the car position to the logger, but only if we are moving (>10kph = ~3m/s)
    # .. or if are receving bearing data, in which case we want to store high resolution position data.
    if ( (_speed > 3.0) or bearing_mode) and chase_logger:
        _car_position_update["speed"] = _speed
        _car_position_update["heading"] = _heading
        chase_logger.add_car_position(_car_position_update)


def handle_client_car_position(client_id, name, data):
    """ Handle a position report from an independently-tracked chase car.

    This is separate from `udp_listener_car_callback` / `car_track` (the
    primary hardware GPS / UDP feed) so that multiple browsers/phones can
    each report their own position without overwriting each other or the
    primary car. It intentionally does not touch bearing_store, chase_logger
    or online_uploader - those are tied to the single physical station/car
    those subsystems assume.
    """
    global client_car_tracks

    _lat = float(data["latitude"])
    _lon = float(data["longitude"])

    try:
        _alt = float(data["altitude"])
    except Exception:
        _alt = 0.0

    _time_dt = datetime.now(timezone.utc)

    _car_position_update = {
        "time": _time_dt,
        "lat": _lat,
        "lon": _lon,
        "alt": _alt,
        "comment": "CAR",
    }
    if "heading" in data:
        _car_position_update["heading"] = data["heading"]
    if "heading_status" in data:
        _car_position_update["heading_status"] = data["heading_status"]

    with client_car_tracks_lock:
        if client_id not in client_car_tracks:
            client_car_tracks[client_id] = {
                "track": GenericTrack(),
                "name": name or client_id,
                "last_seen": time.time(),
            }
        _entry = client_car_tracks[client_id]
        _entry["track"].add_telemetry(_car_position_update)
        if name:
            _entry["name"] = name
        _entry["last_seen"] = time.time()
        _state = _entry["track"].get_latest_state()
        _entry_name = _entry["name"]

    if not _state:
        return

    _car_telem = {
        "callsign": "CAR",
        "car_id": client_id,
        "car_name": _entry_name,
        "position": [_lat, _lon, _alt],
        "vel_v": 0.0,
        "heading": _state["heading"],
        "heading_valid": _state["heading_valid"],
        "heading_status": _state["heading_status"],
        "speed": _state["speed"],
    }

    flask_emit_event("telemetry_event", _car_telem)


def udp_listener_bearing_callback(data, source_position=None):
    global bearing_store, bearing_mode, chase_logger

    if bearing_store != None:
        bearing_store.add_bearing(data, source_position=source_position)
        bearing_mode = True
        if chase_logger:
            chase_logger.add_bearing(data)



@socketio.on("add_manual_bearing", namespace="/chasemapper")
def add_manual_bearing(data):
    """ Add a user-supplied bearing from the web interface.

    If the submission includes a client_id (the submitting browser's own
    persistent id - see the multi-user car tracking above), the person's
    name is appended to 'source' (e.g. "EasyBearing: VK5QI") so bearings
    from different people are distinguishable on the map, without breaking
    the existing manual_bearing_sources substring match in bearings.js
    (which keys off the original "EasyBearing"/"BPI"/"manual" prefix).

    For *relative* bearings specifically (compass-relative, no explicit
    lat/lon - see chasemapper/bearings.py), it's meaningless to fuse them
    with the primary car's position if that's not where this person actually
    is. When we know who submitted it, fuse with THEIR OWN tracked position
    instead; if we don't have one yet (they haven't enabled "Share My Live
    Location"), reject it rather than silently misattributing it.
    """
    try:
        if not isinstance(data, dict):
            udp_listener_bearing_callback(data)
            return

        _client_id = data.get("client_id")
        _source_position = None

        if _client_id:
            data = dict(data)
            _name = data.get("name") or _client_id
            data["source"] = "%s: %s" % (data.get("source") or "EasyBearing", _name)

            if data.get("bearing_type") == "relative":
                with client_car_tracks_lock:
                    _entry = client_car_tracks.get(_client_id)
                    _state = _entry["track"].get_latest_state() if _entry else None

                if not _state:
                    socketio.emit(
                        "bearing_rejected",
                        {"reason": "no_known_position"},
                        namespace="/chasemapper",
                        room=flask.request.sid,
                    )
                    return

                _source_position = {
                    "lat": _state["lat"],
                    "lon": _state["lon"],
                    "speed": _state["speed"],
                    "heading": _state["heading"],
                    "heading_valid": _state["heading_valid"],
                }

        udp_listener_bearing_callback(data, source_position=_source_position)
    except Exception:
        logging.exception("Error handling add_manual_bearing")


# Data Age Monitoring Thread
data_monitor_thread_running = True


def check_data_age():
    """ Regularly check the age of the payload data, and clear if latest position is older than X minutes."""
    global current_payloads, current_payload_tracks, chasemapper_config

    while data_monitor_thread_running:
        _now = time.time()
        # Snapshot callsigns under lock to avoid races while iterating.
        with payloads_lock:
            _callsigns = list(current_payloads.keys())

        for _call in _callsigns:
            try:
                with payloads_lock:
                    _payload = current_payloads.get(_call)
                if not isinstance(_payload, dict):
                    continue

                _telem = _payload.get("telem")
                if not isinstance(_telem, dict):
                    continue

                _latest_time = _telem.get("server_time")
                if _latest_time is None:
                    continue

                if (_now - float(_latest_time)) > (
                    chasemapper_config["payload_max_age"] * 60.0
                ):
                    # Remove stale entries under lock.
                    with payloads_lock:
                        current_payloads.pop(_call, None)
                        current_payload_tracks.pop(_call, None)

                    logging.info(
                        "Payload %s telemetry older than maximum age - removed from data store."
                        % _call
                    )
            except Exception:
                logging.exception("Exception while checking payload data age for %s", _call)

        # Also age out independently-tracked chase cars whose owning browser
        # has gone away (closed tab, lost connection, etc), so long-running
        # servers don't accumulate stale entries.
        with client_car_tracks_lock:
            _client_ids = list(client_car_tracks.keys())

        for _client_id in _client_ids:
            try:
                with client_car_tracks_lock:
                    _entry = client_car_tracks.get(_client_id)
                if not _entry:
                    continue

                if (_now - _entry["last_seen"]) > (
                    chasemapper_config["payload_max_age"] * 60.0
                ):
                    with client_car_tracks_lock:
                        client_car_tracks.pop(_client_id, None)

                    logging.info(
                        "Client car %s position older than maximum age - removed from data store."
                        % _client_id
                    )
            except Exception:
                logging.exception("Exception while checking client car data age for %s", _client_id)

        # Same aging for per-client computed routes (client_routes) — without this
        # a chaser who closes the app mid-chase leaves their last route sitting in
        # memory indefinitely.
        with client_routes_lock:
            _route_client_ids = list(client_routes.keys())

        for _client_id in _route_client_ids:
            try:
                with client_routes_lock:
                    _entry = client_routes.get(_client_id)
                if not _entry:
                    continue

                if (_now - _entry["last_seen"]) > (
                    chasemapper_config["payload_max_age"] * 60.0
                ):
                    with client_routes_lock:
                        client_routes.pop(_client_id, None)

                    logging.info(
                        "Client route %s older than maximum age - removed from data store."
                        % _client_id
                    )
            except Exception:
                logging.exception("Exception while checking client route data age for %s", _client_id)

        time.sleep(2)


def start_listeners(profile):
    """ Stop any currently running listeners, and startup a set of data listeners based on the supplied profile 
    
    Args:
        profile (dict): A dictionary containing:
            'name' (str): Profile name
            'telemetry_source_type' (str): Data source type (ozimux or horus_udp)
            'telemetry_source_port' (int): Data source port
            'car_source_type' (str): Car Position source type (none, horus_udp, gpsd, or station)
            'car_source_port' (int): Car Position source port
            'online_tracker' (str): Which online tracker to upload chase-car info to ('sondehub' or 'sondehubamateur')
    """
    global data_listeners, current_profile, online_uploader, chasemapper_config

    current_profile = profile

    # Stop any existing listeners.
    for _thread in data_listeners:
        try:
            _thread.close()
        except Exception as e:
            logging.error("Error closing thread - %s" % str(e))

    # Shut-down any online uploaders
    if online_uploader != None:
        online_uploader.close()
        online_uploader = None

    # Reset the listeners array.
    data_listeners = []

    # Start up a new online uploader immediately if uploading is already enabled.
    if chasemapper_config["habitat_upload_enabled"] == True:
        if profile["online_tracker"] == "habitat":
            logging.error(
                "Habitat uploader now deprecated due to Habitat retirement, not starting uploader."
            )
        elif profile["online_tracker"] == "sondehub":
            online_uploader = SondehubChaseUploader(
                update_rate=chasemapper_config["habitat_update_rate"],
                callsign=chasemapper_config["habitat_call"],
            )
        elif profile["online_tracker"] == "sondehubamateur":
            online_uploader = SondehubChaseUploader(
                update_rate=chasemapper_config["habitat_update_rate"],
                callsign=chasemapper_config["habitat_call"],
                amateur=True
            )
        else:
            logging.error(
                "Unknown Online Tracker %s, not starting uploader"
                % (profile["online_tracker"])
            )

    # Start up a OziMux listener, if we are using one.
    if profile["telemetry_source_type"] == "ozimux":
        logging.info(
            "Using OziMux data source on UDP Port %d" % profile["telemetry_source_port"]
        )
        _ozi_listener = OziListener(
            telemetry_callback=ozi_listener_callback,
            port=profile["telemetry_source_port"],
        )
        data_listeners.append(_ozi_listener)

    # Start up UDP Broadcast Listener (which we use for car positions even if not for the payload)

    # Case 1 - Both telemetry and car position sources are set to horus_udp, and have the same port set. Only start a single UDP listener
    if (
        (profile["telemetry_source_type"] == "horus_udp")
        and (profile["car_source_type"] == "horus_udp")
        and (profile["car_source_port"] == profile["telemetry_source_port"])
    ):
        # In this case, we start a single Horus UDP listener.
        logging.info(
            "Starting single Horus UDP listener on port %d"
            % profile["telemetry_source_port"]
        )
        _telem_horus_udp_listener = UDPListener(
            summary_callback=udp_listener_summary_callback,
            gps_callback=udp_listener_car_callback,
            bearing_callback=udp_listener_bearing_callback,
            port=profile["telemetry_source_port"],
        )
        _telem_horus_udp_listener.start()
        data_listeners.append(_telem_horus_udp_listener)

    else:
        if profile["telemetry_source_type"] == "horus_udp":
            # Telemetry via Horus UDP - Start up a listener
            logging.info(
                "Starting Telemetry Horus UDP listener on port %d"
                % profile["telemetry_source_port"]
            )
            _telem_horus_udp_listener = UDPListener(
                summary_callback=udp_listener_summary_callback,
                gps_callback=None,
                bearing_callback=udp_listener_bearing_callback,
                port=profile["telemetry_source_port"],
            )
            _telem_horus_udp_listener.start()
            data_listeners.append(_telem_horus_udp_listener)

        if profile["car_source_type"] == "horus_udp":
            # Car Position via Horus UDP - Start up a listener
            logging.info(
                "Starting Car Position Horus UDP listener on port %d"
                % profile["car_source_port"]
            )
            _car_horus_udp_listener = UDPListener(
                summary_callback=None,
                gps_callback=udp_listener_car_callback,
                bearing_callback=udp_listener_bearing_callback,
                port=profile["car_source_port"],
            )
            _car_horus_udp_listener.start()
            data_listeners.append(_car_horus_udp_listener)

        elif profile["car_source_type"] == "gpsd":
            # GPSD Car Position Source
            logging.info("Starting GPSD Car Position Listener.")
            _gpsd_gps = GPSDAdaptor(
                hostname=chasemapper_config["car_gpsd_host"],
                port=chasemapper_config["car_gpsd_port"],
                callback=udp_listener_car_callback,
            )
            data_listeners.append(_gpsd_gps)

        elif profile["car_source_type"] == "serial":
            # Serial GPS Source.
            logging.info("Starting Serial GPS Listener.")
            _serial_gps = SerialGPS(
                serial_port=chasemapper_config["car_serial_port"],
                serial_baud=chasemapper_config["car_serial_baud"],
                callback=udp_listener_car_callback,
            )
            data_listeners.append(_serial_gps)

        elif profile["car_source_type"] == "station":
            logging.info("Using Stationary receiver position.")

        else:
            # No Car position.
            logging.info("No car position data source.")


@socketio.on("profile_change", namespace="/chasemapper")
def profile_change(data):
    """ Client has requested a profile change """
    global chasemapper_config
    logging.info("Client requested change to profile: %s" % data)

    # Change the profile, and restart the listeners.
    chasemapper_config["selected_profile"] = data
    start_listeners(
        chasemapper_config["profiles"][chasemapper_config["selected_profile"]]
    )

    # Update all clients with the new profile selection
    flask_emit_event("server_settings_update", chasemapper_config)


@socketio.on("device_position", namespace="/chasemapper")
def device_position_update(data):
    """ Accept a device position update from a client.

    If the client supplies a `client_id` (a per-browser id, persisted in
    localStorage), the position is tracked independently for that client -
    see handle_client_car_position(). This lets multiple people connect and
    each have their own live position, rather than every browser's location
    overwriting the same shared "CAR" position.

    If no client_id is supplied (older client, or a deliberately shared
    single-operator setup), fall back to the legacy behaviour of treating it
    as the primary chase car position.

    Rate-limited per (source IP, client_id) - not just per IP - so several
    real people sharing one network/NAT (e.g. a chase club on one hotspot)
    don't throttle each other out of a single shared bucket. A coarser
    per-IP backstop still catches one address minting many fake client_ids
    to dodge that. When a client_id is supplied, also gated by an ownership
    lease so one connection can't spoof another still-active connection's
    identity (see _claim_client_car_ownership).
    """
    try:
        _client_id = data.get("client_id") if isinstance(data, dict) else None

        _rl_enabled, _rl_limit, _rl_window_s, _rl_ip_limit = _device_position_rate_limit_config()
        if _rl_enabled and not _testing_mode():
            _client_ip = _get_client_ip()
            _ok_ip, _ = _consume_rate_limit(
                _client_ip, "device_position:ip", _rl_ip_limit, _rl_window_s
            )
            if not _ok_ip:
                return
            _ok, _ = _consume_rate_limit(
                _client_ip,
                f"device_position:{_client_id or 'primary'}",
                _rl_limit,
                _rl_window_s,
            )
            if not _ok:
                return

        if _client_id:
            if not _claim_client_car_ownership(_client_id, flask.request.sid):
                logging.warning(
                    "Rejected device_position for client_id=%s from %s: owned by another active connection.",
                    _client_id,
                    _get_client_ip(),
                )
                return
            _name = data.get("name") or _client_id
            handle_client_car_position(_client_id, _name, data)
        else:
            udp_listener_car_callback(data)
    except Exception:
        logging.exception("Error handling device_position update")


@socketio.on("client_car_clear", namespace="/chasemapper")
def client_car_clear(data):
    """ Clear a single independently-tracked client's chase-car track (their own "Clear My Track" action). """
    try:
        _client_id = data.get("client_id") if isinstance(data, dict) else None
        if not _client_id:
            return
        if not _claim_client_car_ownership(_client_id, flask.request.sid):
            logging.warning(
                "Rejected client_car_clear for client_id=%s from %s: owned by another active connection.",
                _client_id,
                _get_client_ip(),
            )
            return
        with client_car_tracks_lock:
            client_car_tracks.pop(_client_id, None)
    except Exception:
        logging.exception("Error handling client_car_clear")


class WebHandler(logging.Handler):
    """ Logging Handler for sending log messages via Socket.IO to a Web Client """

    def emit(self, record):
        """ Emit a log message via SocketIO """
        # Deal with log records with no content.
        message = record.getMessage() if record else ""
        if message:
            if "socket.io" not in message:
                # Convert log record into a dictionary
                log_data = {
                    "level": record.levelname,
                    "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "msg": message,
                }
                # Emit to all socket.io clients
                socketio.emit("log_event", log_data, namespace="/chasemapper")


if __name__ == "__main__":
    import argparse

    _default_cfg = "horusmapper.cfg"
    if os.path.isdir(_default_cfg):
        _candidate = os.path.join(_default_cfg, "horusmapper.cfg")
        if os.path.isfile(_candidate):
            _default_cfg = _candidate

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "-c",
        "--config",
        type=str,
        default=_default_cfg,
        help="Configuration file.",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", default=False, help="Verbose output."
    )
    parser.add_argument(
        "-l",
        "--log",
        type=str,
        default=None,
        help="Custom log file name. (Default: ./log_files/<timestamp>.log",
    )
    parser.add_argument(
        "--nolog", action="store_true", default=False, help="Inhibit all logging."
    )
    args = parser.parse_args()
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    logging.getLogger("socketio").setLevel(logging.ERROR)
    logging.getLogger("engineio").setLevel(logging.ERROR)

    web_handler = WebHandler()
    logging.getLogger().addHandler(web_handler)

    # Start the Chase Logger (if logging not inhibited.)
    if not args.nolog:
        chase_logger = ChaseLogger(filename=args.log)
    else:
        logging.info("Chase Logging has been inhibited, not starting logger.")

    # Initialise and start background services from config
    try:
        start_services(args.config, start_listeners_flag=True, start_predictor_flag=True)
    except Exception as e:
        logging.critical("Failed to initialise services: %s" % str(e))
        sys.exit(1)

    # Hosting/preview environments assign a listen port via $PORT; honour it
    # over the configured flask_port so the server binds wherever expected.
    if os.environ.get("PORT"):
        chasemapper_config["flask_port"] = int(os.environ["PORT"])

    logging.info(
        "Starting Chasemapper Server on: http://%s:%d/"
        % (chasemapper_config["flask_host"], chasemapper_config["flask_port"])
    )

    try:
        socketio.run(
            app,
            host=chasemapper_config["flask_host"],
            port=chasemapper_config["flask_port"],
            allow_unsafe_werkzeug=True,
        )
    except TypeError:
        logging.debug("Werkzeug param not supported; running without it.")
        socketio.run(app, host=chasemapper_config["flask_host"], port=chasemapper_config["flask_port"]) 

    # Shutdown sequence: attempt to stop background services and close resources.
    predictor_thread_running = False
    data_monitor_thread_running = False

    try:
        if aprs_tracker is not None:
            aprs_tracker.stop()
            aprs_tracker.join(timeout=5)
    except Exception:
        logging.exception("Error stopping APRS tracker")

    if chase_logger:
        try:
            chase_logger.close()
        except Exception:
            pass

    if online_uploader is not None:
        try:
            online_uploader.close()
        except Exception:
            pass

    for _thread in data_listeners:
        try:
            _thread.close()
        except Exception:
            logging.exception("Error closing listener thread")
