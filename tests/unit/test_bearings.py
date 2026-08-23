import chasemapper.bearings as bearings_module
from chasemapper.bearings import Bearings


class FakeSIO:
    def __init__(self):
        self.emits = []

    def emit(self, event, payload, namespace=None):
        self.emits.append((event, payload, namespace))


def _absolute(source="src", bearing=10.0, lat=1.0, lon=2.0, **extra):
    data = {
        "type": "BEARING",
        "bearing_type": "absolute",
        "latitude": lat,
        "longitude": lon,
        "bearing": bearing,
        "source": source,
    }
    data.update(extra)
    return data


def test_update_car_position_and_add_bearings_relative_and_absolute():
    sio = FakeSIO()
    b = Bearings(socketio_instance=sio, max_bearings=10, max_bearing_age=60)

    # Provide a valid car position (mimics GenericTrack.get_latest_state structure)
    car_pos = {
        "time": None,
        "lat": -35.0,
        "lon": 138.0,
        "alt": 100.0,
        "heading": 90.0,
        "heading_valid": True,
        "speed": 5.0,
    }
    b.update_car_position(car_pos)
    assert b.current_car_position["position_valid"] is True

    # Add a relative bearing (fused with current car position)
    rel = {"type": "BEARING", "bearing_type": "relative", "bearing": 45.0, "source": "test_relative"}
    b.add_bearing(rel)
    # There should be at least one stored bearing
    assert len(b.bearings) >= 1

    # Add an absolute bearing (use different source) to ensure more than one bearing exists and an emit happens
    abs_b = {
        "type": "BEARING",
        "bearing_type": "absolute",
        "latitude": -35.1,
        "longitude": 138.1,
        "bearing": 200.0,
        "source": "test_absolute",
    }
    b.add_bearing(abs_b)

    # Ensure bearings store contains at least one entry and includes a sensible true_bearing
    assert len(b.bearings) >= 1
    # Check that at least one stored bearing has a true_bearing near either the fused relative (135) or absolute (200)
    true_bearings = [v.get("true_bearing") for v in b.bearings.values()]
    assert any(tb is not None and (abs(tb - 200.0) < 1e-6 or abs(tb - 135.0) < 1e-6) for tb in true_bearings)

    # add_bearing() only emits once the store holds more than one bearing (see
    # `if len(self.bearings) == 1: return` in bearings.py) - the first
    # add_bearing() call above added no emit, but this second one must have.
    assert len(sio.emits) == 1
    evt, payload, ns = sio.emits[-1]
    assert evt == "bearing_change"
    assert ns == "/chasemapper"
    assert "add" in payload
    assert "true_bearing" in payload["add"]
    # The second bearing (abs_b, true_bearing=200.0) is what was just added;
    # the first (fused relative, true_bearing=135.0) was correctly not
    # removed (only 2 bearings exist, well under max_bearings=10).
    assert payload["add"]["true_bearing"] == 200.0
    assert payload["remove"] == []


def test_add_bearing_same_timestamp_does_not_overwrite(monkeypatch):
    # Two bearings arriving in the same 10ms tick (plausible when two chasers
    # submit within moments of each other) key off "%.2f" % time.time() -
    # force a genuine collision here rather than relying on real clock
    # resolution/timing luck, and confirm the second submission is kept
    # alongside the first instead of silently overwriting it.
    sio = FakeSIO()
    b = Bearings(socketio_instance=sio, max_bearings=10, max_bearing_age=60)

    monkeypatch.setattr(bearings_module.time, "time", lambda: 1_700_000_000.05)

    first = {"type": "BEARING", "bearing_type": "absolute", "latitude": 1.0, "longitude": 2.0, "bearing": 10.0, "source": "alice"}
    second = {"type": "BEARING", "bearing_type": "absolute", "latitude": 3.0, "longitude": 4.0, "bearing": 20.0, "source": "bob"}

    b.add_bearing(first)
    b.add_bearing(second)

    assert len(b.bearings) == 2
    sources = {v["source"] for v in b.bearings.values()}
    assert sources == {"alice", "bob"}

    keys = sorted(b.bearings.keys())
    assert keys == ["1700000000.05", "1700000000.05-1"]
    # Each bearing's stored `key` field must match the dict key it's filed
    # under - the client keys its own store off this field (bearings.js).
    for key, value in b.bearings.items():
        assert value["key"] == key


def test_add_bearing_stale_pruning_survives_disambiguated_keys(monkeypatch):
    # The age-based pruning loop reads each bearing's own "timestamp" field
    # rather than parsing the dict key back into a float - confirm that still
    # works correctly when the oldest entries have a "-N" collision suffix.
    sio = FakeSIO()
    b = Bearings(socketio_instance=sio, max_bearings=10, max_bearing_age=30)

    fake_now = {"t": 1_700_000_000.00}
    monkeypatch.setattr(bearings_module.time, "time", lambda: fake_now["t"])

    old1 = {"type": "BEARING", "bearing_type": "absolute", "latitude": 1.0, "longitude": 1.0, "bearing": 1.0, "source": "old1"}
    old2 = {"type": "BEARING", "bearing_type": "absolute", "latitude": 1.0, "longitude": 1.0, "bearing": 2.0, "source": "old2"}
    b.add_bearing(old1)
    b.add_bearing(old2)  # collides with old1's key -> "...-1" suffix
    assert len(b.bearings) == 2

    # Advance time well past max_bearing_age (30s) and add a fresh bearing -
    # both old (collision-suffixed) entries must be pruned without raising.
    fake_now["t"] += 100
    fresh = {"type": "BEARING", "bearing_type": "absolute", "latitude": 1.0, "longitude": 1.0, "bearing": 3.0, "source": "fresh"}
    b.add_bearing(fresh)

    assert list(b.bearings.values())[-1]["source"] == "fresh"
    assert len(b.bearings) == 1
    evt, payload, ns = sio.emits[-1]
    assert set(payload["remove"]) == {"1700000000.00", "1700000000.00-1"}


def test_add_bearing_defaults_confidence_power_and_source_when_omitted():
    # 'confidence', 'power' and 'source' are all documented as optional in
    # add_bearing()'s docstring - confirm the documented defaults (100.0,
    # -1, "unknown") are actually applied rather than KeyError'ing.
    sio = FakeSIO()
    b = Bearings(socketio_instance=sio)

    minimal = {"type": "BEARING", "bearing_type": "absolute", "latitude": 1.0, "longitude": 2.0, "bearing": 5.0}
    b.add_bearing(minimal)

    stored = list(b.bearings.values())[0]
    assert stored["confidence"] == 100.0
    assert stored["power"] == -1
    assert stored["source"] == "unknown"
    assert "unknown" in b.bearing_sources


def test_add_bearing_ignores_non_bearing_type():
    sio = FakeSIO()
    b = Bearings(socketio_instance=sio)

    b.add_bearing({"type": "GPS", "lat": 1.0, "lon": 2.0})

    assert len(b.bearings) == 0
    assert sio.emits == []


def test_add_bearing_ignores_unknown_bearing_type():
    # Neither 'relative' nor 'absolute' - the else branch returns without
    # storing or raising.
    sio = FakeSIO()
    b = Bearings(socketio_instance=sio)

    b.add_bearing({"type": "BEARING", "bearing_type": "diagonal", "bearing": 1.0})

    assert len(b.bearings) == 0


def test_add_bearing_malformed_absolute_bearing_does_not_raise():
    # Missing 'latitude'/'longitude'/'bearing' hits the try/except around
    # bearing construction and is logged + dropped, not raised.
    sio = FakeSIO()
    b = Bearings(socketio_instance=sio)

    b.add_bearing({"type": "BEARING", "bearing_type": "absolute", "source": "broken"})

    assert len(b.bearings) == 0
    assert sio.emits == []


def test_add_bearing_heading_override_forces_heading_valid():
    # 'heading_override' lets a source explicitly assert whether its heading
    # should be treated as valid, overriding whatever the fused car position
    # said.
    sio = FakeSIO()
    b = Bearings(socketio_instance=sio)
    b.update_car_position({
        "time": None, "lat": 1.0, "lon": 1.0, "alt": 0.0,
        "heading": 0.0, "heading_valid": False, "speed": 0.0,
    })

    rel = {"type": "BEARING", "bearing_type": "relative", "bearing": 30.0, "heading_override": True}
    b.add_bearing(rel)

    assert list(b.bearings.values())[0]["heading_valid"] is True


def test_add_bearing_krakensdr_mirrors_bearing_and_raw_doa():
    # KrakenSDR's relative bearings are reflected across N/S before fusion -
    # confirm both the bearing value and the raw_doa ordering get mirrored.
    sio = FakeSIO()
    b = Bearings(socketio_instance=sio)
    b.update_car_position({
        "time": None, "lat": 0.0, "lon": 0.0, "alt": 0.0,
        "heading": 0.0, "heading_valid": True, "speed": 0.0,
    })

    # add_bearing() only attaches raw_bearing_angles/raw_doa (and only
    # emits) once the store holds more than one bearing - see the
    # `if len(self.bearings) == 1: return` early-out. Prime the store with
    # an unrelated bearing first so the kraken one below hits the normal path.
    b.add_bearing(_absolute(source="primer"))

    kraken = {
        "type": "BEARING",
        "bearing_type": "relative",
        "bearing": 30.0,
        "source": "krakensdr_doa",
        "raw_bearing_angles": [0, 90, 180, 270],
        "raw_doa": [1, 2, 3, 4],
    }
    b.add_bearing(kraken)

    stored = [v for v in b.bearings.values() if v["source"] == "krakensdr_doa"][0]
    assert stored["raw_bearing"] == 330.0  # 360 - 30
    assert stored["true_bearing"] == 330.0  # heading 0 -> unchanged
    assert stored["raw_doa"] == [4, 3, 2, 1]


def test_add_bearing_stores_and_emits_raw_doa_data():
    # raw_bearing_angles/raw_doa are optional extras (e.g. a TDOA polar plot
    # for the web UI) - confirm they land both in the persistent store and
    # in the emitted client_update payload (same dict, so not silently
    # dropped from the broadcast).
    sio = FakeSIO()
    b = Bearings(socketio_instance=sio)

    b.add_bearing(_absolute(source="a"))
    b.add_bearing(_absolute(
        source="b",
        raw_bearing_angles=[0, 120, 240],
        raw_doa=[-1.0, -2.0, -3.0],
    ))

    stored = [v for v in b.bearings.values() if v["source"] == "b"][0]
    assert stored["raw_bearing_angles"] == [0, 120, 240]
    assert stored["raw_doa"] == [-1.0, -2.0, -3.0]

    evt, payload, ns = sio.emits[-1]
    assert payload["add"]["raw_bearing_angles"] == [0, 120, 240]
    assert payload["add"]["raw_doa"] == [-1.0, -2.0, -3.0]


def test_add_bearing_prunes_oldest_when_over_max_bearings(monkeypatch):
    sio = FakeSIO()
    b = Bearings(socketio_instance=sio, max_bearings=3, max_bearing_age=10_000)

    # Force each add_bearing() call a full second apart so keys ("%.2f" %
    # time.time()) never collide/get reused - keeps insertion order
    # unambiguous, isolating this test to just the count-based pruning logic.
    fake_now = {"t": 1_700_000_000.00}
    monkeypatch.setattr(bearings_module.time, "time", lambda: fake_now["t"])

    for i in range(5):
        b.add_bearing(_absolute(source="s%d" % i, bearing=float(i)))
        fake_now["t"] += 1.0

    assert len(b.bearings) == 3
    sources = {v["source"] for v in b.bearings.values()}
    assert sources == {"s2", "s3", "s4"}

    evt, payload, ns = sio.emits[-1]
    # The last add's removal list must include whatever was bumped over the
    # cap by *that* call.
    assert len(payload["remove"]) >= 1


def test_flush_clears_the_bearing_store():
    sio = FakeSIO()
    b = Bearings(socketio_instance=sio)

    b.add_bearing(_absolute(source="a"))
    b.add_bearing(_absolute(source="b"))
    assert len(b.bearings) == 2

    b.flush()

    assert b.bearings == {}
    # bearing_sources (used for the web UI's per-source filter list) is
    # intentionally left alone by flush() - only the bearing data itself
    # is cleared.
    assert b.bearing_sources == ["a", "b"]


def test_remove_source_clears_only_the_matching_source():
    sio = FakeSIO()
    b = Bearings(socketio_instance=sio)

    b.add_bearing(_absolute(source="a", bearing=1.0))
    b.add_bearing(_absolute(source="b", bearing=2.0))
    b.add_bearing(_absolute(source="a", bearing=3.0))
    assert len(b.bearings) == 3

    removed = b.remove_source("a")

    assert len(removed) == 2
    assert len(b.bearings) == 1
    assert list(b.bearings.values())[0]["source"] == "b"
    assert "a" not in b.bearing_sources
    assert "b" in b.bearing_sources

    evt, payload, ns = sio.emits[-1]
    assert evt == "bearing_source_removed"
    assert ns == "/chasemapper"
    assert payload["source"] == "a"
    assert set(payload["removed"]) == set(removed)


def test_remove_source_with_no_matching_bearings_emits_nothing():
    sio = FakeSIO()
    b = Bearings(socketio_instance=sio)

    b.add_bearing(_absolute(source="a"))
    emit_count_before = len(sio.emits)

    removed = b.remove_source("does-not-exist")

    assert removed == []
    assert len(b.bearings) == 1
    # No new emit - nothing was actually removed, so nothing to broadcast.
    assert len(sio.emits) == emit_count_before


def test_source_position_used_only_for_relative_bearings():
    # Per add_bearing()'s docstring, a caller-supplied source_position is
    # ignored for absolute bearings, which already carry their own explicit
    # lat/lon.
    sio = FakeSIO()
    b = Bearings(socketio_instance=sio)

    b.add_bearing(
        _absolute(source="a", lat=9.0, lon=9.0),
        source_position={"lat": -1.0, "lon": -1.0, "speed": 0.0, "heading": 0.0, "heading_valid": True},
    )

    stored = list(b.bearings.values())[0]
    assert (stored["lat"], stored["lon"]) == (9.0, 9.0)
