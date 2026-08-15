const fs = require('fs');
const path = require('path');

/**
 * Load one of the app's static/js/<name> files into the current (jsdom)
 * global scope, the same way a plain <script> tag loads it in the browser.
 *
 * These files are not modules - they declare top-level `function`s and
 * `var`s that the rest of the app expects to find as bare globals /
 * `window.foo`. A plain Node `require()` would instead trap those
 * declarations inside CommonJS's module-wrapper function scope, invisible
 * to anything else.
 *
 * Indirect eval (the `(0, eval)` idiom below) is what fixes that: the spec
 * guarantees indirect eval always runs in the *global* scope of the calling
 * realm, regardless of how deeply nested the call is. Since Jest's jsdom
 * environment makes that realm's global object the jsdom `window`, a
 * `function foo(){}` in the loaded file lands on `window.foo` here too,
 * matching real <script> semantics. (This only works because none of these
 * files declare `"use strict"` at the top - strict-mode indirect eval gets
 * its own scope instead. If a file ever adds one, this loader needs revisiting.)
 */
function loadScript(relativePath) {
  const fullPath = path.join(__dirname, '..', '..', '..', 'static', 'js', relativePath);
  const code = fs.readFileSync(fullPath, 'utf8');
  (0, eval)(code); // eslint-disable-line no-eval
}

module.exports = { loadScript };
