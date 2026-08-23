import datetime

import numpy as np
import pytz

from chasemapper import predictor


def test_predictor_download_model_success():
    messages = []

    def cb(msg):
        messages.append(msg)

    predictor.model_download_running = False
    # 'true' command should exit with code 0 on POSIX systems
    predictor.predictor_download_model("true", cb)

    assert messages == ["OK"]


def test_predictor_download_model_failure():
    messages = []

    def cb(msg):
        messages.append(msg)

    predictor.model_download_running = False
    # 'false' returns non-zero
    predictor.predictor_download_model("false", cb)

    assert messages
    assert messages[0].startswith("Error")


def _fake_gfs_dict():
    # 2 pressure levels, 2 latitudes, 2 longitudes, components = [height, ugrd, vgrd, speed, dir]
    data = np.array(
        [
            [
                [[100.0, 5.0, 0.0, 5.0, 90.0], [100.0, 0.0, 5.0, 5.0, 180.0]],
                [[100.0, -5.0, 0.0, 5.0, 270.0], [100.0, 0.0, -5.0, 5.0, 0.0]],
            ],
            [
                [[5000.0, 10.0, 0.0, 10.0, 90.0], [5000.0, 0.0, 10.0, 10.0, 180.0]],
                [[5000.0, -10.0, 0.0, 10.0, 270.0], [5000.0, 0.0, -10.0, 10.0, 0.0]],
            ],
        ]
    )
    return {
        "pressures": np.array([1000.0, 500.0]),
        "pressure_level_count": 2,
        "latitudes": np.array([-35.0, -34.0]),
        "longitudes": np.array([138.0, 139.0]),
        "data": data,
    }


def test_get_wind_profile_picks_nearest_time_file_and_gridpoint(tmp_path, monkeypatch):
    old_ts = int(datetime.datetime(2026, 1, 1, tzinfo=pytz.utc).timestamp())
    new_ts = int(datetime.datetime(2026, 1, 2, tzinfo=pytz.utc).timestamp())
    (tmp_path / ("gfs_%d_a.dat" % old_ts)).write_text("")
    (tmp_path / ("gfs_%d_b.dat" % new_ts)).write_text("")

    seen_files = []

    def fake_read_cusf_gfs(filename):
        seen_files.append(filename)
        return _fake_gfs_dict()

    monkeypatch.setattr("cusfpredict.reader.read_cusf_gfs", fake_read_cusf_gfs)

    at_time = datetime.datetime(2026, 1, 1, 23, 0, tzinfo=pytz.utc)
    profile = predictor.get_wind_profile(str(tmp_path), -34.9, 138.4, at_time)

    # Closest file to Jan 1 23:00 is the Jan 2 00:00 file.
    assert len(seen_files) == 1
    assert ("gfs_%d_b.dat" % new_ts) in seen_files[0]

    # Nearest gridpoint to (-34.9, 138.4) is (-35.0, 138.0) -> index [0][0].
    assert len(profile) == 2
    assert profile[0]["altitude_m"] == 100.0
    assert profile[0]["speed_ms"] == 5.0
    assert profile[0]["direction_deg"] == 90.0
    assert profile[1]["altitude_m"] == 5000.0
    assert profile[1]["speed_ms"] == 10.0


def test_get_wind_profile_naive_datetime_treated_as_utc(tmp_path, monkeypatch):
    ts = int(datetime.datetime(2026, 1, 1, tzinfo=pytz.utc).timestamp())
    (tmp_path / ("gfs_%d_a.dat" % ts)).write_text("")

    monkeypatch.setattr(
        "cusfpredict.reader.read_cusf_gfs", lambda filename: _fake_gfs_dict()
    )

    # Naive datetime, no tzinfo.
    at_time = datetime.datetime(2026, 1, 1, 0, 30)
    profile = predictor.get_wind_profile(str(tmp_path), -35.0, 138.0, at_time)

    assert len(profile) == 2


def test_get_wind_profile_no_gfs_files_returns_empty(tmp_path):
    profile = predictor.get_wind_profile(
        str(tmp_path), -35.0, 138.0, datetime.datetime(2026, 1, 1, tzinfo=pytz.utc)
    )
    assert profile == []


def test_get_wind_profile_missing_directory_returns_empty():
    profile = predictor.get_wind_profile(
        "/no/such/directory", -35.0, 138.0, datetime.datetime(2026, 1, 1, tzinfo=pytz.utc)
    )
    assert profile == []


def test_get_wind_profile_reader_error_returns_empty(tmp_path, monkeypatch):
    ts = int(datetime.datetime(2026, 1, 1, tzinfo=pytz.utc).timestamp())
    (tmp_path / ("gfs_%d_a.dat" % ts)).write_text("")

    def raise_error(filename):
        raise ValueError("corrupt file")

    monkeypatch.setattr("cusfpredict.reader.read_cusf_gfs", raise_error)

    profile = predictor.get_wind_profile(
        str(tmp_path), -35.0, 138.0, datetime.datetime(2026, 1, 1, tzinfo=pytz.utc)
    )
    assert profile == []
