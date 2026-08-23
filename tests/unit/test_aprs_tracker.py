from chasemapper.aprs_tracker import APRSTracker
from datetime import datetime, timezone


def test_normalize_and_filter_and_timestamp_parsing():
    t = APRSTracker([], 10, lambda p: None)
    assert t._normalize_callsign(' vk5qi ') == 'VK5QI'
    assert t._build_aprsis_filter(['VK5QI','CALL']) == 'p/VK5QI p/CALL'

    # Test timestamp parsing: epoch int, iso string, and None
    dt = t._parse_timestamp(1600000000)
    assert dt is not None and dt.tzinfo is not None
    dt2 = t._parse_timestamp('2020-09-13T12:00:00Z')
    assert dt2 is not None and dt2.tzinfo is not None
    assert t._parse_timestamp(None) is None


def test_extract_lat_lon_and_alt_and_packet_from_polling():
    t = APRSTracker([], 10, lambda p: None)
    payload = {'lat': '12.34', 'lon': '56.78', 'alt': '100'}
    lat, lon = t._extract_lat_lon(payload)
    assert lat == 12.34 and lon == 56.78
    alt = t._extract_altitude(payload)
    assert alt == 100.0

    pkt = t._packet_from_polling('CALL', {'lat': '12.0', 'lon': '13.0', 'time': '1600000000'})
    assert pkt['callsign'] == 'CALL'
    assert 'time_dt' in pkt


def test_duplicate_logic_and_remembering():
    t = APRSTracker(['CALL'], 10, lambda p: None)
    key = 'CALL'
    now = datetime.now(timezone.utc)
    assert not t._is_duplicate(key, None)
    assert not t._is_duplicate(key, now)
    t._remember_packet_time(key, now)
    assert t._is_duplicate(key, now)


def test_run_falls_back_to_polling_when_streaming_raises(monkeypatch):
    # A raised exception anywhere in _run_aprsis() (including the parts of it
    # that build the aprslib.IS connection, outside its own inner try/except)
    # must not kill the tracker thread outright - it should fall back to
    # aprs.fi polling instead, same as the "streaming unavailable" path.
    calls = {"aprsis": 0, "polling": 0}

    def _boom():
        calls["aprsis"] += 1
        raise RuntimeError("simulated aprslib.IS() failure")

    def _record_polling():
        calls["polling"] += 1

    t = APRSTracker(['VK5QI'], 10, lambda p: None)
    monkeypatch.setattr(t, "_run_aprsis", _boom)
    monkeypatch.setattr(t, "_run_polling", _record_polling)

    t.run()  # must return normally, not raise

    assert calls["aprsis"] == 1
    assert calls["polling"] == 1


def test_run_survives_exception_in_polling_fallback_too(monkeypatch):
    # If the polling fallback *also* blows up, run() still must not raise -
    # otherwise the exception propagates out of Thread.run() with no
    # supervisor to restart it, silently ending APRS tracking for the rest
    # of the chase with no error surfaced anywhere but stderr.
    t = APRSTracker(['VK5QI'], 10, lambda p: None)
    monkeypatch.setattr(t, "_run_aprsis", lambda: False)  # streaming unavailable -> try polling

    def _boom():
        raise RuntimeError("simulated polling failure")

    monkeypatch.setattr(t, "_run_polling", _boom)

    t.run()  # must not raise


def test_run_does_not_fall_back_when_aprsis_streamed_successfully():
    # _run_aprsis() returning True means it streamed until told to stop -
    # polling must not also run in that case.
    calls = {"polling": 0}
    t = APRSTracker(['VK5QI'], 10, lambda p: None)
    t._run_aprsis = lambda: True
    t._run_polling = lambda: calls.__setitem__("polling", calls["polling"] + 1)

    t.run()

    assert calls["polling"] == 0
