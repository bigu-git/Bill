/* NOW OR NEVER — js/pwa.js
   Registers the service worker so the game can be installed and works offline.
   Needs https (GitHub Pages is https) or localhost. Failing here never affects the game. */
(function (global) {
  'use strict';
  if (!('serviceWorker' in global.navigator)) return;
  global.addEventListener('load', function () {
    global.navigator.serviceWorker.register('sw.js').catch(function (err) {
      try { console.warn('[NOW OR NEVER] offline mode unavailable', err); } catch (e) { /* ignore */ }
    });
  });
})(window);
