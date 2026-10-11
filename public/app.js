/**
 * अशब्द (A-Shabd) — Antique Manuscript Procedural Parchment Generator
 * Generates organic watermarks, creases, cellulose fibers, tide-lines, and foxing spots.
 */

(function () {
  'use strict';

  const canvas = document.getElementById('parchment-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let dpr = 1;

  // Simple pseudo-random seeded generator for consistent organic realism
  let seed = 42;
  function random() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderParchment();
  }

  function renderParchment() {
    seed = 87421; // Reset seed on each render for stable beauty
    ctx.clearRect(0, 0, width, height);

    // 1. Organic Edge & Corner Moisture Tide Stains
    drawMoistureStains();

    // 2. Fine Creases & Age Wrinkles
    drawPaperCreases();

    // 3. Foxing Spots (Centuries-old oxidation freckles)
    drawFoxingSpots();

    // 4. Subtle Cellulose Paper Fibers & Hairline Scratches
    drawPaperFibers();
  }

  /**
   * Draws soft watercolor-like moisture pools and irregular tide-lines
   */
  function drawMoistureStains() {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';

    // Stains concentrated around edges and corners - harmonized for uniform page brightness
    const stainZones = [
      { x: 0, y: 0, r: Math.max(width, height) * 0.42, c1: 'rgba(92, 45, 18, 0.08)', c2: 'rgba(92, 45, 18, 0.02)' },
      { x: width, y: height, r: Math.max(width, height) * 0.48, c1: 'rgba(78, 36, 15, 0.09)', c2: 'rgba(78, 36, 15, 0.02)' },
      { x: 0, y: height, r: Math.max(width, height) * 0.38, c1: 'rgba(105, 52, 24, 0.07)', c2: 'rgba(105, 52, 24, 0.015)' },
      { x: width, y: 0, r: Math.max(width, height) * 0.4, c1: 'rgba(85, 42, 17, 0.08)', c2: 'rgba(85, 42, 17, 0.015)' },
      { x: width * 0.1, y: height * 0.5, r: width * 0.25, c1: 'rgba(120, 60, 25, 0.04)', c2: 'rgba(120, 60, 25, 0.01)' },
      { x: width * 0.9, y: height * 0.45, r: width * 0.28, c1: 'rgba(110, 55, 22, 0.04)', c2: 'rgba(110, 55, 22, 0.01)' },
      { x: width * 0.5, y: height * 0.05, r: width * 0.3, c1: 'rgba(130, 65, 28, 0.03)', c2: 'rgba(130, 65, 28, 0.01)' },
      { x: width * 0.52, y: height * 0.95, r: width * 0.32, c1: 'rgba(100, 48, 20, 0.04)', c2: 'rgba(100, 48, 20, 0.01)' }
    ];

    stainZones.forEach(zone => {
      const grad = ctx.createRadialGradient(zone.x, zone.y, zone.r * 0.2, zone.x, zone.y, zone.r);
      grad.addColorStop(0, zone.c1);
      grad.addColorStop(0.7, zone.c2);
      grad.addColorStop(1, 'transparent');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2);
      ctx.fill();

      // Irregular outer tide ring
      drawTideRing(zone.x, zone.y, zone.r * 0.85);
    });

    ctx.restore();
  }

  /**
   * Draws the characteristic darker drying tide-boundary of evaporated water on old parchment
   */
  function drawTideRing(cx, cy, radius) {
    ctx.save();
    ctx.strokeStyle = 'rgba(84, 40, 16, 0.045)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();

    const points = 32;
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const distortion = (random() - 0.5) * (radius * 0.22);
      const r = radius + distortion;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draws fine antique fold creases and weathered paper cracks
   */
  function drawPaperCreases() {
    ctx.save();
    const creaseCount = Math.floor(Math.min(width, height) / 140) + 4;

    for (let c = 0; c < creaseCount; c++) {
      // Keep creases mostly outside the dead center reading zone
      let x1 = random() * width;
      let y1 = random() * height;
      let angle = random() * Math.PI * 2;
      let length = 120 + random() * 380;
      let x2 = x1 + Math.cos(angle) * length;
      let y2 = y1 + Math.sin(angle) * length;

      // Dark shadow edge of crease
      ctx.strokeStyle = 'rgba(48, 24, 10, 0.055)';
      ctx.lineWidth = 0.8 + random() * 0.6;
      ctx.beginPath();
      ctx.moveTo(x1, y1);

      // Add gentle organic wobble to crease
      const midX = (x1 + x2) / 2 + (random() - 0.5) * 18;
      const midY = (y1 + y2) / 2 + (random() - 0.5) * 18;
      ctx.quadraticCurveTo(midX, midY, x2, y2);
      ctx.stroke();

      // Highlight side of crease (paper ridge catching ambient light)
      ctx.strokeStyle = 'rgba(255, 248, 230, 0.08)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x1 + 1, y1 + 1);
      ctx.quadraticCurveTo(midX + 1, midY + 1, x2 + 1, y2 + 1);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Draws rusty reddish-brown oxidation spots ("foxing") common in centuries-old paper
   */
  function drawFoxingSpots() {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';

    const spotCount = 38 + Math.floor(random() * 25);
    const centerX = width / 2;
    const centerY = height / 2;
    const safeRadius = Math.min(width, height) * 0.28; // Avoid direct text center

    for (let i = 0; i < spotCount; i++) {
      let x = random() * width;
      let y = random() * height;

      // Distance from center
      const dist = Math.hypot(x - centerX, y - centerY);
      if (dist < safeRadius) {
        // Push outward toward perimeter
        const angle = Math.atan2(y - centerY, x - centerX);
        x = centerX + Math.cos(angle) * (safeRadius + random() * 120);
        y = centerY + Math.sin(angle) * (safeRadius + random() * 120);
      }

      const spotRadius = 1.2 + random() * 5.5;
      const opacity = 0.08 + random() * 0.16;

      const grad = ctx.createRadialGradient(x, y, 0, x, y, spotRadius);
      grad.addColorStop(0, `rgba(138, 55, 24, ${opacity})`);
      grad.addColorStop(0.45, `rgba(105, 45, 18, ${opacity * 0.6})`);
      grad.addColorStop(1, 'transparent');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, spotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Draws subtle individual cellulose fibers and antique hairline scratches
   */
  function drawPaperFibers() {
    ctx.save();
    const fiberCount = Math.floor((width * height) / 12000);

    for (let f = 0; f < fiberCount; f++) {
      const x = random() * width;
      const y = random() * height;
      const length = 5 + random() * 18;
      const angle = random() * Math.PI * 2;
      const curvature = (random() - 0.5) * 8;

      const isLight = random() > 0.65;
      ctx.strokeStyle = isLight
        ? 'rgba(255, 250, 235, 0.12)'
        : 'rgba(58, 28, 12, 0.06)';
      ctx.lineWidth = 0.4 + random() * 0.5;

      ctx.beginPath();
      ctx.moveTo(x, y);
      const cpX = x + Math.cos(angle) * (length / 2) + Math.sin(angle) * curvature;
      const cpY = y + Math.sin(angle) * (length / 2) - Math.cos(angle) * curvature;
      const endX = x + Math.cos(angle) * length;
      const endY = y + Math.sin(angle) * length;

      ctx.quadraticCurveTo(cpX, cpY, endX, endY);
      ctx.stroke();
    }

    ctx.restore();
  }

  // Initialize and handle smooth responsive resize
  window.addEventListener('resize', () => {
    window.requestAnimationFrame(resize);
  });

  // Render on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', resize);
  } else {
    resize();
  }
})();

/**
 * ==========================================================================
 * Ashabd (अशब्द) — 3D Ancient Notice Board & Subscription Interactive Engine
 * ==========================================================================
 */
(function initNoticeBoard() {
  'use strict';

  function setup() {
    const promptSheet = document.getElementById('paperPromptSheet');
    const formSheet = document.getElementById('paperFormSheet');
    const closeBtn = document.getElementById('paperCloseBtn');
    const emailInput = document.getElementById('subscriberEmail');
    const submitBtn = document.getElementById('subscribeSubmitBtn');
    const feedback = document.getElementById('subscribeFeedback');
    const form = document.getElementById('subscribeForm');

    if (!promptSheet || !formSheet) return;

    let isAnimating = false;

    // Trigger the paper-falling tumble animation and reveal subscription form
    function triggerPaperFall() {
      if (isAnimating) return;
      isAnimating = true;

      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (prefersReducedMotion) {
        promptSheet.style.display = 'none';
        formSheet.style.display = 'block';
        formSheet.setAttribute('aria-hidden', 'false');
        formSheet.classList.add('paper-revealed');
        isAnimating = false;
        if (emailInput) setTimeout(() => emailInput.focus(), 60);
        return;
      }

      promptSheet.classList.add('paper-falling');

      // Tumble animation duration is 0.75s; transition to revealed form at 0.55s
      setTimeout(() => {
        promptSheet.style.display = 'none';
        promptSheet.classList.remove('paper-falling');

        formSheet.style.display = 'block';
        formSheet.setAttribute('aria-hidden', 'false');
        formSheet.classList.remove('paper-revealed');
        void formSheet.offsetWidth; // Force DOM reflow
        formSheet.classList.add('paper-revealed');

        isAnimating = false;
        if (emailInput) setTimeout(() => emailInput.focus(), 80);
      }, 550);
    }

    // Dismiss subscription form and pin prompt paper back in place
    function closeFormSheet() {
      formSheet.classList.remove('paper-revealed');
      formSheet.style.display = 'none';
      formSheet.setAttribute('aria-hidden', 'true');

      promptSheet.style.display = 'block';
      promptSheet.classList.remove('paper-falling');

      const formView = document.getElementById('paperFormView');
      const successView = document.getElementById('paperSuccessView');
      if (formView) formView.style.display = 'block';
      if (successView) successView.style.display = 'none';

      if (feedback) {
        feedback.style.display = 'none';
        feedback.className = 'paper-feedback-msg';
        feedback.textContent = '';
      }
      if (emailInput) emailInput.value = '';
    }

    // Prompt paper click and keyboard events
    promptSheet.addEventListener('click', triggerPaperFall);
    promptSheet.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        triggerPaperFall();
      }
    });

    // Close button
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeFormSheet();
      });
    }

    let isSubmitting = false;

    // Global form submission handler
    window.handleSubscriptionSubmit = async function (event) {
      if (event && event.preventDefault) event.preventDefault();

      if (isSubmitting) return;
      if (!emailInput || !submitBtn || !feedback) return;

      const email = (emailInput.value || '').trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!email || !emailRegex.test(email)) {
        feedback.className = 'paper-feedback-msg feedback-error';
        feedback.textContent = 'Please enter a valid email address.';
        feedback.style.display = 'block';
        emailInput.focus();
        return;
      }

      isSubmitting = true;
      submitBtn.disabled = true;
      const originalBtnText = submitBtn.innerHTML;
      submitBtn.innerHTML = '<span>Subscribing...</span>';
      feedback.style.display = 'none';

      try {
        const response = await fetch('/api/subscribers/subscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (response.ok && data.success) {
          const formView = document.getElementById('paperFormView');
          const successView = document.getElementById('paperSuccessView');
          const successHeading = document.getElementById('paperSuccessHeading');
          const successBody = document.getElementById('paperSuccessBody');

          if (successHeading && successBody) {
            if (data.already_active) {
              successHeading.innerHTML = '<span>धन्यवाद!</span><span class="paper-success-subheading">(Thank You!)</span>';
              successBody.textContent = 'You are already subscribed to Ashabd (आप पहले से ही जुड़े हैं)।';
            } else {
              successHeading.innerHTML = '<span>धन्यवाद!</span><span class="paper-success-subheading">(Thank You!)</span>';
              successBody.textContent = 'Please check your email to confirm your subscription.';
            }
          }

          if (formView) formView.style.display = 'none';
          if (successView) {
            successView.style.display = 'block';
            successView.classList.remove('paper-fade-in');
            void successView.offsetWidth;
            successView.classList.add('paper-fade-in');
          }

          emailInput.value = '';
        } else {
          feedback.className = 'paper-feedback-msg feedback-error';
          feedback.textContent = data.error || 'Something went wrong. Please try again.';
          feedback.style.display = 'block';
        }
      } catch (err) {
        feedback.className = 'paper-feedback-msg feedback-error';
        feedback.textContent = 'Network error. Please check your connection.';
        feedback.style.display = 'block';
      } finally {
        isSubmitting = false;
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
      }
    };

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
