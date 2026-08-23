#!/usr/bin/env python
#
#   Project Horus - Browser-Based Chase Mapper - Predictor
#
#   Copyright (C) 2018  Mark Jessop <vk5qi@rfhead.net>
#   Released under GNU GPL v3 or later
#
import glob
import logging
import os
import subprocess
from threading import Thread

model_download_running = False


def get_wind_profile(gfs_path, lat, lon, at_time):
    """ Read the local GFS data and return wind speed/direction by altitude
    near (lat, lon), closest in time to at_time.

    This is a display-only helper - any failure (missing directory, no GFS
    files, bad file contents) returns an empty list rather than raising, so
    it can never break the actual landing prediction.
    """
    try:
        import numpy as np
        from cusfpredict.reader import read_cusf_gfs

        gfs_files = glob.glob(os.path.join(gfs_path, "gfs_*.dat"))
        if not gfs_files:
            return []

        # Treat naive datetimes as UTC, consistent with chasemapper.tawhiri.
        if at_time.tzinfo is None:
            import pytz

            at_time = pytz.utc.localize(at_time)
        _target_ts = at_time.timestamp()

        def _file_timestamp(filename):
            return int(os.path.basename(filename).split("_")[1])

        _closest_file = min(
            gfs_files, key=lambda f: abs(_file_timestamp(f) - _target_ts)
        )

        _gfs = read_cusf_gfs(_closest_file)

        _lat_idx = int(np.argmin(np.abs(_gfs["latitudes"] - lat)))
        _lon_idx = int(np.argmin(np.abs(_gfs["longitudes"] - (lon % 360))))

        _profile = []
        for _level in range(_gfs["pressure_level_count"]):
            _height, _ugrd, _vgrd, _speed, _direction = _gfs["data"][
                _level, _lat_idx, _lon_idx
            ]
            _profile.append(
                {
                    "altitude_m": float(_height),
                    "pressure_hpa": float(_gfs["pressures"][_level]),
                    "speed_ms": float(_speed),
                    "direction_deg": float(_direction) % 360.0,
                }
            )

        _profile.sort(key=lambda p: p["altitude_m"])

        return _profile

    except Exception as e:
        logging.error("Error reading wind profile from GFS data: %s" % str(e))
        return []


def predictor_download_model(command, callback):
    """ Run the supplied command, which should download a GFS model and place it into the GFS directory 

    When the downloader completes, or if an error is thrown, the status is passed to a callback function.
    """
    global model_download_running

    if model_download_running:
        return

    model_download_running = True

    try:
        ret_code = subprocess.call(command, shell=True)
    except Exception as e:
        # Something broke when running the detection function.
        logging.error("Error when attempting to download model - %s" % (str(e)))
        model_download_running = False
        callback("Error - See log.")
        return

    model_download_running = False

    if ret_code == 0:
        logging.info("Model Download Completed.")
        callback("OK")
        return
    else:
        logging.error("Model Downloader returned code %d" % ret_code)
        callback("Error: Ret Code %d" % ret_code)
        return


def predictor_spawn_download(command, callback=None):
    """ Spawn a model downloader in a new thread """
    global model_download_running

    if model_download_running:
        return "Already Downloading."

    _download_thread = Thread(
        target=predictor_download_model,
        kwargs={"command": command, "callback": callback},
    )
    _download_thread.start()

    return "Started downloader."


if __name__ == "__main__":
    import sys
    from .config import parse_config_file
    from cusfpredict.utils import gfs_model_age, available_gfs

    _cfg_file = sys.argv[1]

    _cfg = parse_config_file(_cfg_file)

    if _cfg["pred_model_download"] == "none":
        print("Model download not enabled.")
        sys.exit(1)

    predictor_download_model(_cfg["pred_model_download"])

    print(available_gfs(_cfg["pred_gfs_directory"]))
