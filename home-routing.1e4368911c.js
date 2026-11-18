/* z11: preserve existing portal/bookmark and CMS-preview URLs. */
(function () {
  'use strict';
  function routeLegacyLink() {
    var hash = '';
    try { hash = decodeURIComponent(window.location.hash.slice(1)); } catch (_) {}
    var section = hash.split('/')[0];
    var legacy = ['stress', 'animation', 'guide', 'doctor'].indexOf(section) !== -1;
    var preview = new URLSearchParams(window.location.search).has('editorPreview');
    if (legacy || preview) {
      var target = new URL('catheter.html', window.location.href);
      target.search = window.location.search;
      target.hash = window.location.hash;
      window.location.replace(target.href);
    }
  }
  routeLegacyLink();
  window.addEventListener('hashchange', routeLegacyLink);
}());
