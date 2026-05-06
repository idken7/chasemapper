import sys
import time
import subprocess
import importlib.util
from pathlib import Path
import pytest


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'tests' / 'fixtures'
import sys
sys.path.insert(0, str(ROOT))


def _load_module_from_path(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, str(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope='session')
def fake_sondehub_server():
    """Start the simple Flask fake SondeHub app in a subprocess for the test session.

    Yields a dict with host/port and the subprocess handle.
    """
    app_path = FIXTURES / 'fake_sondehub_app.py'
    proc = subprocess.Popen([sys.executable, str(app_path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    # give the server a moment to start
    time.sleep(0.5)
    yield {'host': '127.0.0.1', 'port': 5002, 'proc': proc}
    proc.terminate()
    try:
        proc.wait(timeout=2)
    except Exception:
        proc.kill()


@pytest.fixture(scope='session')
def fake_pred_path():
    """Return path to the pred stub script for tests to invoke as a binary."""
    return str(FIXTURES / 'fake_pred' / 'pred_stub.py')


@pytest.fixture
def udp_sender():
    mod_path = FIXTURES / 'udp_sender.py'
    mod = _load_module_from_path(mod_path)
    return mod.send_udp
