const count = document.getElementById('count');
const query = new URLSearchParams(window.location.search);

document.documentElement.dataset.theme = query.get('theme') === 'dark' ? 'dark' : 'light';
count.textContent = query.get('seconds') || '3';

window.countdown.onUpdate((value) => {
  count.textContent = value;
  count.classList.remove('tick');
  requestAnimationFrame(() => count.classList.add('tick'));
});

window.countdown.onTheme((theme) => {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
});
