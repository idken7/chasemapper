"""
Integration tests for the mobile-facing HTTP API surface:
/api/route, /api/latest_route, /api/mobile_state.

These exercise horusmapper's Flask `app` directly via `app.test_client()`
(no live server / socket needed). OSRM is stubbed with `responses` so no
network access occurs.
"""
import pytest
import requests
import responses

import horusmapper


@pytest.fixture(autouse=True)
def _reset_api_state(monkeypatch):
    """Reset module-level mutable state shared across requests so tests don't
    leak into each other (route cache, rate-limit buckets, auth/rate-limit
    env toggles)."""
    monkeypatch.setenv("CHASEMAPPER_TESTING", "1")
    monkeypatch.delenv("CHASEMAPPER_REQUIRE_API_AUTH", raising=False)
    monkeypatch.delenv("CHASEMAPPER_API_KEY", raising=False)
    monkeypatch.delenv("CHASEMAPPER_API_RATE_LIMIT_ENABLED", raising=False)
    monkeypatch.delenv("CHASEMAPPER_API_RATE_LIMIT_PER_MIN", raising=False)
    monkeypatch.delenv("CHASEMAPPER_API_RATE_LIMIT_WINDOW_S", raising=False)

    with horusmapper.latest_route_lock:
        horusmapper.latest_route_geojson = None
        horusmapper.latest_route_meta = {
            "distance_m": None,
            "duration_s": None,
            "provider": None,
            "provider_base": None,
            "updated_at": None,
            "steps": None,
        }
    with horusmapper.api_rate_limit_lock:
        horusmapper.api_rate_limit_buckets.clear()

    yield

    with horusmapper.api_rate_limit_lock:
        horusmapper.api_rate_limit_buckets.clear()


@pytest.fixture
def client():
    app, _socketio = horusmapper.create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _osrm_success_body():
    return {
        "routes": [
            {
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-83.0, 39.0], [-83.1, 39.1]],
                },
                "distance": 1234.5,
                "duration": 300.0,
                "legs": [
                    {
                        "steps": [
                            {
                                "maneuver": {"type": "depart", "modifier": None, "location": [-83.0, 39.0]},
                                "name": "Main St",
                                "distance": 800.0,
                            },
                            {
                                "maneuver": {"type": "turn", "modifier": "left", "location": [-83.05, 39.05]},
                                "name": "County Rd 12",
                                "distance": 434.5,
                            },
                            {
                                "maneuver": {"type": "arrive", "modifier": None, "location": [-83.1, 39.1]},
                                "name": "",
                                "distance": 0.0,
                            },
                        ]
                    }
                ],
            },
            {
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-83.0, 39.0], [-83.15, 39.05], [-83.1, 39.1]],
                },
                "distance": 1000.0,
                "duration": 500.0,
                "legs": [{"steps": []}],
            },
        ]
    }


# ---------------------------------------------------------------------------
# POST /api/route
# ---------------------------------------------------------------------------

@responses.activate
def test_api_route_success(client):
    responses.add(
        responses.GET,
        "https://router.project-osrm.org/route/v1/driving/-83.0,39.0;-83.2,39.2",
        json=_osrm_success_body(),
        status=200,
    )

    resp = client.post(
        "/api/route",
        json={"start_lat": 39.0, "start_lon": -83.0, "end_lat": 39.2, "end_lon": -83.2},
    )

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["provider"] == "osrm"
    assert body["distance_m"] == 1234.5
    assert body["duration_s"] == 300.0
    assert body["feature"]["type"] == "Feature"
    assert body["feature"]["geometry"]["type"] == "LineString"

    # steps: normalized turn-by-turn from the fastest route's legs/steps.
    assert body["steps"] == [
        {"type": "depart", "modifier": None, "name": "Main St", "distance_m": 800.0, "location": [-83.0, 39.0]},
        {"type": "turn", "modifier": "left", "name": "County Rd 12", "distance_m": 434.5, "location": [-83.05, 39.05]},
        {"type": "arrive", "modifier": None, "name": "", "distance_m": 0.0, "location": [-83.1, 39.1]},
    ]

    # alternatives: fastest (lower duration) and shortest (lower distance) picked
    # independently, matching chase_routing.js's selection logic.
    assert len(body["alternatives"]) == 2
    fastest, shortest = body["alternatives"]
    assert fastest["label"] == "fastest"
    assert fastest["duration_s"] == 300.0
    assert fastest["distance_m"] == 1234.5
    assert shortest["label"] == "shortest"
    assert shortest["distance_m"] == 1000.0
    assert shortest["duration_s"] == 500.0
    assert shortest["steps"] == []


def test_api_route_invalid_coordinates(client):
    resp = client.post(
        "/api/route",
        json={"start_lat": "not-a-number", "start_lon": -83.0, "end_lat": 39.2, "end_lon": -83.2},
    )
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_api_route_missing_coordinates(client):
    resp = client.post("/api/route", json={"start_lat": 39.0})
    assert resp.status_code == 400
    assert "error" in resp.get_json()


@responses.activate
def test_api_route_osrm_unavailable_returns_502(client):
    responses.add(
        responses.GET,
        "https://router.project-osrm.org/route/v1/driving/-83.0,39.0;-83.2,39.2",
        body=requests.exceptions.ConnectionError("simulated OSRM connection failure"),
    )

    resp = client.post(
        "/api/route",
        json={"start_lat": 39.0, "start_lon": -83.0, "end_lat": 39.2, "end_lon": -83.2},
    )

    assert resp.status_code == 502
    assert "error" in resp.get_json()


@responses.activate
def test_api_route_osrm_no_routes_returns_500(client):
    responses.add(
        responses.GET,
        "https://router.project-osrm.org/route/v1/driving/-83.0,39.0;-83.2,39.2",
        json={"routes": []},
        status=200,
    )

    resp = client.post(
        "/api/route",
        json={"start_lat": 39.0, "start_lon": -83.0, "end_lat": 39.2, "end_lon": -83.2},
    )

    assert resp.status_code == 500
    assert "error" in resp.get_json()


# ---------------------------------------------------------------------------
# /api/latest_route
# ---------------------------------------------------------------------------

def test_api_latest_route_get_returns_404_when_empty(client):
    resp = client.get("/api/latest_route")
    assert resp.status_code == 404


def test_api_latest_route_post_then_get_round_trips(client):
    feature = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[-83.0, 39.0], [-83.1, 39.1]]},
        "properties": {"distance_m": 500.0, "duration_s": 60.0},
    }

    post_resp = client.post("/api/latest_route", json=feature)
    assert post_resp.status_code == 200
    assert post_resp.get_json() == {"status": "ok"}

    get_resp = client.get("/api/latest_route")
    assert get_resp.status_code == 200
    assert get_resp.get_json() == feature


def test_api_latest_route_post_invalid_geojson_returns_400(client):
    resp = client.post("/api/latest_route", json={"not": "geojson"})
    assert resp.status_code == 400
    assert "error" in resp.get_json()


# ---------------------------------------------------------------------------
# GET /api/mobile_state
# ---------------------------------------------------------------------------

def test_api_mobile_state_returns_expected_shape(client):
    resp = client.get("/api/mobile_state")
    assert resp.status_code == 200
    body = resp.get_json()

    assert "server_time" in body
    assert "car" in body
    assert "target" in body
    assert "route" in body
    assert "eta" in body
    assert set(body["route"].keys()) >= {
        "geojson", "distance_m", "duration_s", "provider", "provider_base", "updated_at", "steps",
    }
    assert set(body["eta"].keys()) >= {
        "route_duration_s", "payload_time_to_landing_s", "payload_time_to_landing",
    }


# ---------------------------------------------------------------------------
# Auth (CHASEMAPPER_REQUIRE_API_AUTH / CHASEMAPPER_API_KEY)
# ---------------------------------------------------------------------------

def test_api_auth_not_required_by_default_in_testing_mode(client):
    # CHASEMAPPER_TESTING=1 (set by the autouse fixture) disables the
    # enforce_api_endpoint_security before_request hook entirely, so requests
    # succeed with no key even though CHASEMAPPER_REQUIRE_API_AUTH isn't set.
    resp = client.get("/api/mobile_state")
    assert resp.status_code == 200


def test_api_auth_required_rejects_missing_key(client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_REQUIRE_API_AUTH", "true")
    monkeypatch.setenv("CHASEMAPPER_API_KEY", "s3cret-key")

    resp = client.get("/api/mobile_state")
    assert resp.status_code == 401


def test_api_auth_required_accepts_correct_key(client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_REQUIRE_API_AUTH", "true")
    monkeypatch.setenv("CHASEMAPPER_API_KEY", "s3cret-key")

    resp = client.get("/api/mobile_state", headers={"X-API-Key": "s3cret-key"})
    assert resp.status_code == 200


def test_api_auth_required_rejects_wrong_key(client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_REQUIRE_API_AUTH", "true")
    monkeypatch.setenv("CHASEMAPPER_API_KEY", "s3cret-key")

    resp = client.get("/api/mobile_state", headers={"X-API-Key": "wrong-key"})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

def test_api_rate_limit_returns_429_after_limit_exceeded(client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_API_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("CHASEMAPPER_API_RATE_LIMIT_PER_MIN", "2")
    monkeypatch.setenv("CHASEMAPPER_API_RATE_LIMIT_WINDOW_S", "60")

    first = client.get("/api/latest_route")
    second = client.get("/api/latest_route")
    third = client.get("/api/latest_route")

    # First two requests consume the limit (both may be 404 - no route stored
    # - or 200; either way they must not be rate-limited).
    assert first.status_code != 429
    assert second.status_code != 429
    assert third.status_code == 429
    body = third.get_json()
    assert "retry_after_s" in body
    assert "Retry-After" in third.headers


def test_api_rate_limit_disabled_allows_many_requests(client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_API_RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("CHASEMAPPER_API_RATE_LIMIT_PER_MIN", "1")

    for _ in range(5):
        resp = client.get("/api/latest_route")
        assert resp.status_code != 429
