// Small progressive enhancements; every page works without this script.
(function () {
  // Language switch: keep the current section. The guide uses the same section
  // ids in every language (enforced by frontend/src/test/manualContent.test.ts).
  document.querySelectorAll('a[data-keep-hash]').forEach(function (link) {
    link.addEventListener('click', function () {
      if (window.location.hash) {
        link.href = link.href.split('#')[0] + window.location.hash;
      }
    });
  });

  // On narrow screens the table of contents starts collapsed.
  if (window.matchMedia('(max-width: 52rem)').matches) {
    document.querySelectorAll('.toc details[open]').forEach(function (d) {
      d.removeAttribute('open');
    });
  }
})();
