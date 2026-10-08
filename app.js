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
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
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

    // Stains concentrated around edges and corners
    const stainZones = [
      { x: 0, y: 0, r: Math.max(width, height) * 0.42, c1: 'rgba(92, 45, 18, 0.18)', c2: 'rgba(92, 45, 18, 0.04)' },
      { x: width, y: height, r: Math.max(width, height) * 0.48, c1: 'rgba(78, 36, 15, 0.2)', c2: 'rgba(78, 36, 15, 0.04)' },
      { x: 0, y: height, r: Math.max(width, height) * 0.38, c1: 'rgba(105, 52, 24, 0.16)', c2: 'rgba(105, 52, 24, 0.03)' },
      { x: width, y: 0, r: Math.max(width, height) * 0.4, c1: 'rgba(85, 42, 17, 0.17)', c2: 'rgba(85, 42, 17, 0.03)' },
      { x: width * 0.1, y: height * 0.5, r: width * 0.25, c1: 'rgba(120, 60, 25, 0.08)', c2: 'rgba(120, 60, 25, 0.02)' },
      { x: width * 0.9, y: height * 0.45, r: width * 0.28, c1: 'rgba(110, 55, 22, 0.09)', c2: 'rgba(110, 55, 22, 0.02)' },
      { x: width * 0.5, y: height * 0.05, r: width * 0.3, c1: 'rgba(130, 65, 28, 0.07)', c2: 'rgba(130, 65, 28, 0.02)' },
      { x: width * 0.52, y: height * 0.95, r: width * 0.32, c1: 'rgba(100, 48, 20, 0.1)', c2: 'rgba(100, 48, 20, 0.02)' }
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
    const safeRadius = Math.min(width, height) * 0.32; // Avoid direct logo center

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
