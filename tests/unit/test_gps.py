import pytest
from chasemapper.gps import SerialGPS


def test_dm_to_sd_and_parse_nmea_calls_callback():
    calls = []

    def cb(packet):
        calls.append(packet)

    gps = SerialGPS(unittest=True, callback=cb)

    # dm_to_sd conversion
    dm_lat = "12319.943281"
    dm_lon = "12345.678900"
    expected_lat = gps.dm_to_sd(dm_lat)
    expected_lon = gps.dm_to_sd(dm_lon)
    assert expected_lat == pytest.approx(123 + 19.943281 / 60)
    assert expected_lon == pytest.approx(123 + 45.678900 / 60)

    # Send a GPRMC line (populates latitude/longitude/speed)
    gprmc = f"$GPRMC,000000.00,A,{dm_lat},N,{dm_lon},E,10.0,0.0,010180,,,A*00"
    gps.parse_nmea(gprmc)

    # Send a GPGGA line (populates altitude/fix status and triggers callback)
    gpgga = f"$GPGGA,000000.00,{dm_lat},N,{dm_lon},E,1,08,1.0,100.0,M,0.0,M,,*00"
    gps.parse_nmea(gpgga)

    # Callback should have been invoked once (GGA triggers send_to_callback)
    assert len(calls) == 1
    state = calls[0]
    assert state["latitude"] == pytest.approx(expected_lat)
    assert state["longitude"] == pytest.approx(expected_lon)
    # altitude set from GGA
    assert "altitude" in gps.gps_state and gps.gps_state["altitude"] == pytest.approx(100.0)
    # valid flag should be True for fix_status 1
    assert gps.gps_state["valid"] is True
