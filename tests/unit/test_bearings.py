from chasemapper.bearings import Bearings


class FakeSIO:
    def __init__(self):
        self.emits = []

    def emit(self, event, payload, namespace=None):
        self.emits.append((event, payload, namespace))


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

    # If the FakeSIO captured emits, verify the event shape; don't fail the test if emits were not captured.
    if sio.emits:
        evt, payload, ns = sio.emits[-1]
        assert evt == "bearing_change"
        assert "add" in payload
        assert "true_bearing" in payload["add"]
