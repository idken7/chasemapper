import json

import pytest

import chasemapper.logger as logger_module
from chasemapper.logger import ChaseLogger


class _StopLoop(Exception):
    pass


def _stop_background_thread_and_drive_manually(logger):
    """ChaseLogger.__init__ starts a real background thread looping on a real
    5s time.sleep(). For a deterministic test we stop that thread immediately
    and drive process_queue() ourselves, breaking out of its loop via a
    monkeypatched time.sleep() that raises - the same "run exactly one
    iteration, no real waiting" pattern used elsewhere in this test suite
    (see test_multi_user_and_security.py's check_data_age tests)."""
    logger.input_processing_running = False
    logger.log_process_thread.join(timeout=2)
    logger.input_processing_running = True


def test_chaselogger_flushes_written_data_to_disk(tmp_path, monkeypatch):
    log_path = tmp_path / "test_chase.log"
    logger = ChaseLogger(filename=str(log_path))
    try:
        _stop_background_thread_and_drive_manually(logger)
        logger.input_queue.put({"log_type": "TEST", "value": 42})

        fsync_calls = []
        real_fsync = logger_module.os.fsync
        monkeypatch.setattr(
            logger_module.os, "fsync",
            lambda fd: (fsync_calls.append(fd), real_fsync(fd))[1]
        )

        def _sleep_and_stop(_seconds):
            raise _StopLoop()
        monkeypatch.setattr(logger_module.time, "sleep", _sleep_and_stop)

        with pytest.raises(_StopLoop):
            logger.process_queue()

        # os.fsync() must actually have been invoked - not just flush() -
        # since flush() alone still leaves data in the OS page cache, which a
        # power loss (a realistic failure mode on a car-powered Pi) can lose.
        assert fsync_calls == [logger.f.fileno()]

        # Read via an *independent* file handle without closing logger.f -
        # this only sees the data if it was actually flushed out of Python's
        # internal write buffer, not just queued for a future flush.
        with open(log_path, "r") as f:
            lines = f.readlines()
        assert len(lines) == 1
        assert json.loads(lines[0])["value"] == 42
    finally:
        logger.input_processing_running = False
        try:
            logger.f.close()
        except Exception:
            pass


def test_chaselogger_does_not_flush_on_idle_poll_with_nothing_queued(tmp_path, monkeypatch):
    log_path = tmp_path / "test_chase_idle.log"
    logger = ChaseLogger(filename=str(log_path))
    try:
        _stop_background_thread_and_drive_manually(logger)

        flush_calls = []
        monkeypatch.setattr(logger.f, "flush", lambda: flush_calls.append(1))

        def _sleep_and_stop(_seconds):
            raise _StopLoop()
        monkeypatch.setattr(logger_module.time, "sleep", _sleep_and_stop)

        with pytest.raises(_StopLoop):
            logger.process_queue()

        assert flush_calls == []
    finally:
        logger.input_processing_running = False
        try:
            logger.f.close()
        except Exception:
            pass


def test_chaselogger_multiple_queued_items_flushed_once(tmp_path, monkeypatch):
    # Flushing/fsyncing once per drain of the queue (not once per item) keeps
    # this cheap even when several updates arrive in the same ~5s window.
    log_path = tmp_path / "test_chase_multi.log"
    logger = ChaseLogger(filename=str(log_path))
    try:
        _stop_background_thread_and_drive_manually(logger)
        for i in range(5):
            logger.input_queue.put({"log_type": "TEST", "value": i})

        fsync_calls = []
        real_fsync = logger_module.os.fsync
        monkeypatch.setattr(
            logger_module.os, "fsync",
            lambda fd: (fsync_calls.append(fd), real_fsync(fd))[1]
        )

        def _sleep_and_stop(_seconds):
            raise _StopLoop()
        monkeypatch.setattr(logger_module.time, "sleep", _sleep_and_stop)

        with pytest.raises(_StopLoop):
            logger.process_queue()

        assert len(fsync_calls) == 1
        with open(log_path, "r") as f:
            lines = f.readlines()
        assert len(lines) == 5
    finally:
        logger.input_processing_running = False
        try:
            logger.f.close()
        except Exception:
            pass
