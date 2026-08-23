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

## Frontend (JavaScript) tests

`static/js/` has no build step or module system - these are plain `<script>`-tag
files loaded directly by `templates/index.html`. `tests/js/` tests them the same
way, using Jest + jsdom and a small loader (`tests/js/helpers/loadScript.js`)
that evals each file into the test's global scope so its top-level `function`s
land as real globals, matching real `<script>` semantics (a plain Node
`require()` would instead trap them inside a CommonJS module wrapper).

Quick usage (local), from the repo root:

```bash
npm install
npm test
```

Notes:
- Coverage is intentionally selective: pure/self-contained functions (`utils.js`,
  `bearings.js`) and the handful of files that load cleanly with minimal stubs
  (`cesium-map.js`, `sondehub.js`, `chase_routing.js`). Deeply DOM/Leaflet/Cesium
  -coupled UI code (e.g. most of `settings.js`, `balloon.js`'s telemetry handler)
  isn't covered here - it would need a much larger mocking investment for
  comparatively low value, and is better exercised via `tests/gui/test_aprs_ui.py`
  (a real headless-browser test against the full running app).
- Real `jquery` is a dev dependency and is loaded (not stubbed) wherever a file
  under test needs `$` - under jsdom, `require('jquery')` returns the ready-made
  jQuery object directly (jsdom's `document` already exists at require-time), not
  the `window => jQuery` factory form some docs show for plain Node.
- A couple of files (`sondehub.js`, `chase_routing.js`) schedule a real
  `setInterval`/poller at load time; their test files call `jest.useFakeTimers()`
  before loading them so that doesn't tick for real during a test run.
