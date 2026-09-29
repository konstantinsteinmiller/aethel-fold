/* Aethel Fold — static splash progress (see index.html, src/use/useBoot.ts). */
// Boot progress before any module runs: the bar creeps forward by itself so
// it never looks stuck, and each boot stage (main.ts, the save hydrate, the
// app mount, the game's first frame — see src/use/useBoot.ts) pushes it to
// its milestone. FLogoProgress continues from `value` when Vue mounts.
(function () {
  var fill = document.getElementById('splash-fill')
  var b = window.__boot = {
    target: 8,
    value: 0,
    set: function (p) { if (p > b.target) b.target = p }
  }
  var tick = function () {
    var cap = Math.min(99, b.target + 14)
    b.value += Math.max(0, (b.target - b.value) * 0.06) + (b.value < cap ? 0.06 : 0)
    if (b.value > 100) b.value = 100
    if (fill) fill.style.width = b.value.toFixed(1) + '%'
    if (document.getElementById('static-splash')) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})()
