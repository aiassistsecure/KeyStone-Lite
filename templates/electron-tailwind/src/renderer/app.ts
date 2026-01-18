document.getElementById('btn-minimize')?.addEventListener('click', () => {
  window.electron.window.minimize();
});

document.getElementById('btn-maximize')?.addEventListener('click', () => {
  window.electron.window.maximize();
});

document.getElementById('btn-close')?.addEventListener('click', () => {
  window.electron.window.close();
});

console.log('App initialized on platform:', window.electron.platform);
