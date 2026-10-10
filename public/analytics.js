(function() {
  'use strict';
  if (typeof window === 'undefined') return;
  const path = window.location.pathname;
  if (path.startsWith('/admin') || path.startsWith('/api')) return;

  let isReturning = false;
  try {
    isReturning = !!localStorage.getItem('ashabd_vt');
    if (!isReturning) {
      localStorage.setItem('ashabd_vt', Date.now().toString());
    }
  } catch (_) {}

  const startTime = Date.now();
  let maxScroll = 0;
  let readFired = false;
  const referrer = document.referrer || '';

  function sendEvent(eventType, duration) {
    const payload = JSON.stringify({
      path: path,
      type: eventType,
      ref: referrer,
      is_returning: isReturning,
      duration: duration || Math.round((Date.now() - startTime) / 1000),
      screen_w: window.innerWidth || 0
    });

    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/analytics/collect', blob);
      } else {
        fetch('/api/analytics/collect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(function() {});
      }
    } catch (_) {}
  }

  // 1. Initial Page View
  sendEvent('pageview', 0);

  // 2. Scroll depth monitoring
  function onScroll() {
    const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (totalHeight > 0) {
      const scrollRatio = window.scrollY / totalHeight;
      if (scrollRatio > maxScroll) maxScroll = scrollRatio;
    }
    // If scrolled past 50% or spent at least 18s, mark as read
    if (!readFired && (maxScroll >= 0.5 || Date.now() - startTime >= 18000)) {
      readFired = true;
      sendEvent('read', Math.round((Date.now() - startTime) / 1000));
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  // 3. Fallback reading completion for short poems without scrollbar
  setTimeout(function() {
    if (!readFired && !document.hidden) {
      readFired = true;
      sendEvent('read', Math.round((Date.now() - startTime) / 1000));
    }
  }, 20000);

  // 4. Active heartbeat ping every 45s while visible
  setInterval(function() {
    if (!document.hidden) {
      sendEvent('ping', Math.round((Date.now() - startTime) / 1000));
    }
  }, 45000);

  // 5. Final duration on page unload / hide
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (elapsed >= 3) {
        sendEvent('duration', elapsed);
      }
    }
  });
})();
