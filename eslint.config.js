const globals = require('globals');

// static/js is plain <script>-tag files with no module system or bundler
// (see package.json's description) - every var/function is an intentional
// global shared across files by load order. A standard no-undef-strict
// config would flag most of the codebase for that, so it's scoped here to
// what's actually useful for this architecture: catching genuinely unused
// code (see the dead toggle_bearing_plot_size() this caught in bearings.js).
module.exports = [
  {
    ignores: [
      // Vendored third-party libraries and plugins, not this project's own
      // code - linting them (especially the minified ones) is pure noise.
      'static/js/*.min.js',
      'static/js/leaflet.js',
      'static/js/micropolar-v0.2.2.js',
      'static/js/paho-mqtt.js',
      'static/js/Leaflet.Control.Custom.js',
      'static/js/Leaflet.PolylineMeasure.js',
      'static/js/leaflet-control-topcenter.js',
      'static/js/leaflet.rotatedMarker.js',
      'static/js/easy-button.js',
    ],
  },
  {
    files: ['static/js/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      ecmaVersion: 2021,
      globals: {
        ...globals.browser,
        ...globals.jquery,
      },
    },
    rules: {
      'no-undef': 'off',
      // vars: 'local' - only flag unused variables/functions declared *inside*
      // a function, not top-level ones. Top-level functions/vars here are this
      // file's public surface for every other file/inline HTML handler (the
      // same cross-file-global architecture no-undef is off for above), so
      // ESLint - which only sees one file at a time - can't tell a genuinely
      // dead top-level declaration from one called elsewhere; flagging those
      // would bury real findings (like the toggle_bearing_plot_size() this
      // caught) under false positives. caughtErrors: 'none' - this codebase
      // has many intentional `catch (e) {}` swallow-and-ignore blocks; that's
      // a deliberate pattern here, not a bug to flag on every occurrence.
      'no-unused-vars': ['warn', { vars: 'local', caughtErrors: 'none' }],
    },
  },
];
