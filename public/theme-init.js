// Applies the saved colour theme before the app renders (avoids a flash of the wrong theme).
try {
  var p = localStorage.getItem('ks-theme') || 'dark';
  var t = p === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : p;
  document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
} catch (e) {
  document.documentElement.dataset.theme = 'dark';
}
