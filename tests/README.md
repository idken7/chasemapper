Test fixtures and usage

Files added:
- `tests/requirements-dev.txt` - dev/test dependencies (pytest, responses, etc.)
- `tests/fixtures/udp_sender.py` - simple UDP datagram sender helper
- `tests/fixtures/fake_sondehub_app.py` - lightweight Flask app emulating SondeHub/Tawhiri
- `tests/fixtures/fake_pred/pred_stub.py` - small pred stub script
- `tests/conftest.py` - pytest fixtures to run the fake services and helpers

Quick usage (local):

1. Install dev deps (preferably in a virtualenv):

```bash
python -m pip install -r tests/requirements-dev.txt
```

2. Run pytest (fixtures available):

```bash
pytest -q
```

Notes:
- `fake_sondehub_server` fixture launches the Flask app on port `5002` by default.
- `fake_pred_path` points to `tests/fixtures/fake_pred/pred_stub.py` which can be executed with `python <path>` in tests.
- The fixtures are lightweight; later integration tests can use them to simulate external services without network dependencies.
