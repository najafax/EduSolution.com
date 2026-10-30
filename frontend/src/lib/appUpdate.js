// Tiny store for "a new version of the app has been downloaded". main.jsx
// feeds it from the service worker; components/UpdateBanner.jsx shows it.
let waiting = false;
const listeners = new Set();

export function setUpdateReady() {
  waiting = true;
  listeners.forEach((fn) => fn(true));
}

export function isUpdateReady() {
  return waiting;
}

export function subscribeUpdate(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Activates the waiting service worker and reloads onto the new version.
// Does not rely on the library's own reload: asks the waiting worker to take
// over, reloads when the controller changes, and reloads anyway after 3s.
export function installUpdate() {
  if (!('serviceWorker' in navigator)) return window.location.reload();
  let done = false;
  const reload = () => {
    if (done) return;
    done = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', reload);
  setTimeout(reload, 3000);
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    else reload();
  }).catch(reload);
}
