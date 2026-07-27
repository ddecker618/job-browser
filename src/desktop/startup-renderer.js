const stages = [
  'Preparing application',
  'Locating database',
  'Checking database',
  'Backing up database',
  'Applying database updates',
  'Starting local service',
  'Loading dashboard',
  'Ready',
];
const desktop = window.jobBrowserDesktop;
desktop.onStartupProgress((stage) => {
  document.querySelector('#stage').textContent = stage;
  document.querySelector('#bar').style.width =
    `${Math.max(12, ((stages.indexOf(stage) + 1) / stages.length) * 100)}%`;
});
desktop.onStartupFailure((failure) => {
  document.querySelector('#title').textContent = failure.title;
  document.querySelector('#message').textContent = failure.message;
  document.querySelector('#database').textContent = failure.databasePath;
  document.querySelector('#failure').hidden = false;
});
document
  .querySelector('#retry')
  .addEventListener('click', () => desktop.retryStartup());
document
  .querySelector('#logs')
  .addEventListener('click', () => desktop.openLogsFolder());
document
  .querySelector('#data')
  .addEventListener('click', () => desktop.openDataFolder());
document
  .querySelector('#copy')
  .addEventListener('click', () => desktop.copyDiagnostics());
document
  .querySelector('#exit')
  .addEventListener('click', () => desktop.safeExit());
