(() => {
  let theme = 'dark';
  try {
    if (localStorage.getItem('workshop-theme') === 'light') theme = 'light';
  } catch { /* A private browsing setting may block local storage. */ }
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#f5f7fa' : '#15171c';
})();
