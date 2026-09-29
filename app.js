/**
 * काव्य-कुंज (Kavya-Kunj) - Main Application Script
 * Handcrafted with love for poetry lovers.
 */

// ---------------- State Management ----------------
const state = {
  theme: localStorage.getItem('kavya_theme') || 'noor',
  favorites: JSON.parse(localStorage.getItem('kavya_favorites') || '[]'),
  customPoems: JSON.parse(localStorage.getItem('kavya_custom_poems') || '[]'),
  currentCategory: 'all',
  searchQuery: '',
  activeModalPoem: null,
  fontSizeMultiplier: 1.0,
  ambiance: 'off', // 'off' | 'rain' | 'tanpura'
  isSpeaking: false
};

// Curated Sher Collection for "आज का शेर"
const dailyShers = [
  {
    verse: "कुछ तो बात है ख़ामोशी में तेरी,\nवरना यूँ ही नहीं कागज़ पे अश्क उतरते।",
    author: "मेरी क़लम से",
    tag: "दर्द-ओ-अल्फ़ाज़"
  },
  {
    verse: "मुद्दतों बाद आज फिर चाय ठंडी हो गई,\nतेरी यादों का सिलसिला इतना गरम था।",
    author: "मेरी क़लम से",
    tag: "यादें"
  },
  {
    verse: "कागज़ की कश्ती थी और पानी का किनारा था,\nखेलने की मस्ती थी, ये दिल भी आवारा था।",
    author: "सुदर्शन फ़ाकिर",
    tag: "मासूमियत"
  },
  {
    verse: "हज़ार बर्क़ गिरे लाख आंधियाँ उट्ठें,\nवो फूल खिल के रहेंगे जो खिलने वाले हैं।",
    author: "साहिर लुधियानवी",
    tag: "उम्मीद"
  },
  {
    verse: "सितारों से आगे जहाँ और भी हैं,\nअभी इश्क़ के इम्तिहाँ और भी हैं।",
    author: "अल्लामा इक़बाल",
    tag: "फ़लसफ़ा"
  }
];

let currentSherIndex = 0;

// Combine default poems and user's custom poems
function getAllPoems() {
  return [...state.customPoems, ...(typeof poemsData !== 'undefined' ? poemsData : [])];
}

// ---------------- Initialization ----------------
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initDailySher();
  renderFilterPills();
  renderPoems();
  updateFeaturedPoem();
  initAmbianceAudio();
  initEventListeners();
});

// ---------------- Theme Management ----------------
function initTheme() {
  applyTheme(state.theme);
  const themeBtn = document.getElementById('themeToggleBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', toggleTheme);
  }
}

function applyTheme(themeName) {
  state.theme = themeName;
  localStorage.setItem('kavya_theme', themeName);
  
  if (themeName === 'noor') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', themeName);
  }

  const themeIcon = document.getElementById('themeIcon');
  if (themeIcon) {
    if (themeName === 'mushaira') {
      themeIcon.textContent = '🌙';
      themeIcon.title = 'शब-ए-महफ़िल (रात्रि थीम सक्रिय)';
    } else if (themeName === 'gulab') {
      themeIcon.textContent = '🌸';
      themeIcon.title = 'गुलाब (सैंडलवुड थीम सक्रिय)';
    } else {
      themeIcon.textContent = '☀️';
      themeIcon.title = 'नूर (काग़ज़ी थीम सक्रिय)';
    }
  }
}

function toggleTheme() {
  const themes = ['noor', 'mushaira', 'gulab'];
  const nextIndex = (themes.indexOf(state.theme) + 1) % themes.length;
  applyTheme(themes[nextIndex]);
  showToast(`थीम बदली: ${themes[nextIndex] === 'noor' ? 'नूर (Parchment)' : themes[nextIndex] === 'mushaira' ? 'शब-ए-महफ़िल (Midnight)' : 'गुलाब (Rose)'}`);
}

// ---------------- Daily Sher (आज का शेर) ----------------
function initDailySher() {
  renderDailySher();
  const nextSherBtn = document.getElementById('nextSherBtn');
  const copySherBtn = document.getElementById('copySherBtn');
  
  if (nextSherBtn) {
    nextSherBtn.addEventListener('click', () => {
      currentSherIndex = (currentSherIndex + 1) % dailyShers.length;
      renderDailySher();
    });
  }

  if (copySherBtn) {
    copySherBtn.addEventListener('click', () => {
      const current = dailyShers[currentSherIndex];
      const textToCopy = `"${current.verse}"\n— ${current.author}`;
      navigator.clipboard.writeText(textToCopy).then(() => {
        showToast('शेर कॉपी कर लिया गया है!');
      });
    });
  }
}

function renderDailySher() {
  const sher = dailyShers[currentSherIndex];
  const verseEl = document.getElementById('dailySherVerse');
  const authorEl = document.getElementById('dailySherAuthor');
  const tagEl = document.getElementById('dailySherTag');

  if (verseEl && authorEl) {
    verseEl.style.opacity = '0';
    setTimeout(() => {
      verseEl.innerHTML = sher.verse.replace(/\n/g, '<br>');
      authorEl.textContent = `— ${sher.author}`;
      if (tagEl) tagEl.innerHTML = `✦ आज का शेर • <span style="font-weight:400; opacity:0.8">${sher.tag}</span>`;
      verseEl.style.opacity = '1';
    }, 150);
  }
}

// ---------------- Filter & Search ----------------
function renderFilterPills() {
  const container = document.getElementById('filterPills');
  if (!container) return;

  const categories = ['all', 'नज़्म', 'ग़ज़ल', 'कविता', 'मुक्तक', 'पसंदीदा'];
  container.innerHTML = categories.map(cat => {
    const label = cat === 'all' ? 'सभी रचनाएँ' : cat === 'पसंदीदा' ? '❤️ पसंदीदा' : cat;
    const isActive = state.currentCategory === cat ? 'active' : '';
    return `<button class="filter-pill ${isActive}" data-category="${cat}">${label}</button>`;
  }).join('');

  container.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentCategory = btn.getAttribute('data-category');
      renderPoems();
    });
  });
}

function getFilteredPoems() {
  let poems = getAllPoems();

  // Category filter
  if (state.currentCategory === 'पसंदीदा') {
    poems = poems.filter(p => state.favorites.includes(p.id));
  } else if (state.currentCategory !== 'all') {
    poems = poems.filter(p => p.category === state.currentCategory);
  }

  // Search filter
  if (state.searchQuery.trim()) {
    const q = state.searchQuery.toLowerCase().trim();
    poems = poems.filter(p => {
      const matchTitle = (p.title || '').toLowerCase().includes(q);
      const matchTranslit = (p.transliteration || '').toLowerCase().includes(q);
      const matchTag = (p.tag || '').toLowerCase().includes(q);
      const matchExcerpt = (p.excerpt || '').toLowerCase().includes(q);
      const matchLines = p.stanzas ? p.stanzas.flat().some(line => line.toLowerCase().includes(q)) : false;
      return matchTitle || matchTranslit || matchTag || matchExcerpt || matchLines;
    });
  }

  return poems;
}

// ---------------- Render Poems Grid ----------------
function renderPoems() {
  const grid = document.getElementById('poemsGrid');
  const countEl = document.getElementById('poemsCountText');
  if (!grid) return;

  const poems = getFilteredPoems();
  if (countEl) {
    countEl.textContent = `${poems.length} रचनाएँ उपलब्ध`;
  }

  if (poems.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🪶</div>
        <h3>कोई रचना नहीं मिली</h3>
        <p>आपके द्वारा खोजे गए शब्द या श्रेणी में अभी कोई कविता उपलब्ध नहीं है।</p>
        <button class="btn-primary" style="margin-top: 1.25rem;" onclick="resetFilters()">सभी कविताएँ देखें</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = poems.map(poem => {
    const isFav = state.favorites.includes(poem.id);
    return `
      <article class="poem-card" data-id="${poem.id}">
        <div class="card-top">
          <div class="card-meta-badges">
            <span class="badge-category">${poem.category}</span>
            <span class="badge-tag">#${poem.tag}</span>
          </div>
          <div class="card-actions">
            <button class="card-action-btn ${isFav ? 'favorited' : ''}" title="पसंदीदा बनाएं" onclick="toggleFavorite('${poem.id}', event)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
              </svg>
            </button>
            <button class="card-action-btn" title="कार्ड शेयर / डाउनलोड करें" onclick="openShareCard('${poem.id}', event)">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="18" cy="5" r="3"></circle>
                <circle cx="6" cy="12" r="3"></circle>
                <circle cx="18" cy="19" r="3"></circle>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
              </svg>
            </button>
          </div>
        </div>

        <h3 class="poem-card-title">${poem.title}</h3>
        <p class="poem-card-translit">${poem.transliteration || ''}</p>

        <div class="poem-card-excerpt">
          ${poem.excerpt || (poem.stanzas && poem.stanzas[0] ? poem.stanzas[0].slice(0, 2).join('<br>') : '')}
        </div>

        <div class="card-footer">
          <span>📅 ${poem.date} • ⏱️ ${poem.readTime || '2 मिनट'}</span>
          <button class="btn-read-poem" onclick="openPoemModal('${poem.id}')">
            पूरी रचना पढ़ें <span>&rarr;</span>
          </button>
        </div>
      </article>
    `;
  }).join('');
}

function resetFilters() {
  state.currentCategory = 'all';
  state.searchQuery = '';
  const searchInput = document.getElementById('poemSearchInput');
  if (searchInput) searchInput.value = '';
  renderFilterPills();
  renderPoems();
}

// ---------------- Featured Poem Banner ----------------
function updateFeaturedPoem() {
  const all = getAllPoems();
  if (all.length === 0) return;
  const featured = all[0]; // First poem as featured
  
  const titleEl = document.getElementById('featuredPoemTitle');
  const metaEl = document.getElementById('featuredPoemMeta');
  const stanzasEl = document.getElementById('featuredPoemStanzas');
  const readBtn = document.getElementById('featuredReadBtn');

  if (titleEl && featured) {
    titleEl.textContent = featured.title;
    if (metaEl) {
      metaEl.textContent = `${featured.category} • ${featured.tag} • ${featured.date}`;
    }
    if (stanzasEl && featured.stanzas && featured.stanzas[0]) {
      stanzasEl.innerHTML = featured.stanzas[0].join('<br>') + 
        `<span class="stanza-divider">❦ ❦ ❦</span>` + 
        (featured.stanzas[1] ? featured.stanzas[1].join('<br>') : '');
    }
    if (readBtn) {
      readBtn.onclick = () => openPoemModal(featured.id);
    }
  }
}

// ---------------- Favorites System ----------------
function toggleFavorite(id, event) {
  if (event) event.stopPropagation();
  const index = state.favorites.indexOf(id);
  if (index > -1) {
    state.favorites.splice(index, 1);
    showToast('पसंदीदा सूची से हटाया गया');
  } else {
    state.favorites.push(id);
    showToast('❤️ पसंदीदा में जोड़ लिया गया!');
  }
  localStorage.setItem('kavya_favorites', JSON.stringify(state.favorites));
  renderPoems();
}

// ---------------- Reading Modal / Zen Reader ----------------
function openPoemModal(id) {
  const poem = getAllPoems().find(p => p.id === id);
  if (!poem) return;

  state.activeModalPoem = poem;
  const modal = document.getElementById('poemModal');
  const title = document.getElementById('modalPoemTitle');
  const meta = document.getElementById('modalPoemMeta');
  const container = document.getElementById('modalStanzasContainer');
  const glossaryBox = document.getElementById('modalGlossaryBox');
  const glossaryGrid = document.getElementById('modalGlossaryGrid');
  const essenceBox = document.getElementById('modalEssenceBox');
  const essenceText = document.getElementById('modalEssenceText');

  title.textContent = poem.title;
  meta.innerHTML = `<span>शैली: <strong>${poem.category}</strong></span> • <span>${poem.date}</span> • <span>⏱️ ${poem.readTime || '2 मिनट'}</span>`;

  // Render Stanzas with interactive glossary highlights
  container.innerHTML = poem.stanzas.map(stanza => {
    const formattedLines = stanza.map(line => {
      let markedLine = line;
      if (poem.glossary && poem.glossary.length > 0) {
        poem.glossary.forEach(item => {
          const reg = new RegExp(`(${item.word})`, 'g');
          markedLine = markedLine.replace(reg, `<span class="glossary-word" title="${item.meaning}">$1</span>`);
        });
      }
      return markedLine;
    }).join('<br>');

    return `<div class="modal-stanza"><p>${formattedLines}</p></div>`;
  }).join('<div class="stanza-divider">❦</div>');

  // Render Glossary
  if (poem.glossary && poem.glossary.length > 0) {
    glossaryBox.style.display = 'block';
    glossaryGrid.innerHTML = poem.glossary.map(item => `
      <div class="glossary-item">
        <strong>${item.word}</strong>: <span>${item.meaning}</span>
      </div>
    `).join('');
  } else {
    glossaryBox.style.display = 'none';
  }

  // Render Essence / भावार्थ
  if (poem.essence) {
    essenceBox.style.display = 'block';
    essenceText.textContent = poem.essence;
  } else {
    essenceBox.style.display = 'none';
  }

  // Reset TTS speaking
  stopRecitation();

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closePoemModal() {
  const modal = document.getElementById('poemModal');
  if (modal) {
    modal.classList.remove('active');
  }
  document.body.style.overflow = '';
  stopRecitation();
}

// Font Size Adjuster inside Modal
function adjustFontSize(delta) {
  state.fontSizeMultiplier = Math.min(1.4, Math.max(0.85, state.fontSizeMultiplier + delta));
  const container = document.getElementById('modalStanzasContainer');
  if (container) {
    container.style.fontSize = `${1.35 * state.fontSizeMultiplier}rem`;
    container.style.lineHeight = `${2.2 * state.fontSizeMultiplier}`;
  }
}

// ---------------- Text to Speech (Hindi Recitation) ----------------
function toggleRecitation() {
  if (!state.activeModalPoem) return;

  if (state.isSpeaking) {
    stopRecitation();
  } else {
    startRecitation(state.activeModalPoem);
  }
}

function startRecitation(poem) {
  if (!('speechSynthesis' in window)) {
    showToast('आपका ब्राउज़र आवाज़ वाचन का समर्थन नहीं करता');
    return;
  }

  window.speechSynthesis.cancel();

  // Combine stanzas into readable text with natural pauses
  const fullText = poem.stanzas.map(stanza => stanza.join(' ')).join('. ');
  const utterance = new SpeechSynthesisUtterance(fullText);
  utterance.lang = 'hi-IN';
  utterance.rate = 0.85; // Poetic slow cadence
  utterance.pitch = 0.95;

  // Attempt to select Hindi voice if available
  const voices = window.speechSynthesis.getVoices();
  const hindiVoice = voices.find(v => v.lang.includes('hi') || v.lang.includes('Hindi'));
  if (hindiVoice) {
    utterance.voice = hindiVoice;
  }

  utterance.onstart = () => {
    state.isSpeaking = true;
    updateRecitationUI(true);
    showToast('कविता का वाचन प्रारंभ...');
  };

  utterance.onend = () => {
    state.isSpeaking = false;
    updateRecitationUI(false);
  };

  utterance.onerror = () => {
    state.isSpeaking = false;
    updateRecitationUI(false);
  };

  window.speechSynthesis.speak(utterance);
}

function stopRecitation() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  state.isSpeaking = false;
  updateRecitationUI(false);
}

function updateRecitationUI(speaking) {
  const btn = document.getElementById('recitePoemBtn');
  if (!btn) return;
  if (speaking) {
    btn.innerHTML = `<span>⏹️</span> <span>वाचन रोकें</span>`;
    btn.classList.add('active');
  } else {
    btn.innerHTML = `<span>🎙️</span> <span>वाचन सुनें</span>`;
    btn.classList.remove('active');
  }
}

// ---------------- Download Aesthetic Sher Card (HTML5 Canvas) ----------------
function openShareCard(id, event) {
  if (event) event.stopPropagation();
  const poem = getAllPoems().find(p => p.id === id);
  if (!poem) return;

  generateAestheticCard(poem);
}

function generateAestheticCard(poem) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Instagram Post Square 1080x1080
  const width = 1080;
  const height = 1080;
  canvas.width = width;
  canvas.height = height;

  const isDark = state.theme === 'mushaira';
  const bgColor = isDark ? '#10131d' : '#f9f5ed';
  const textColor = isDark ? '#f4eedb' : '#231d17';
  const accentColor = isDark ? '#e5b369' : '#9b2226';
  const mutedColor = isDark ? '#8d94a5' : '#7d7063';
  const goldColor = '#c59b27';

  // 1. Draw Background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  // Subtle radial gradient center
  const radGrad = ctx.createRadialGradient(width/2, height/2, 100, width/2, height/2, 600);
  radGrad.addColorStop(0, isDark ? '#1a1f30' : '#ffffff');
  radGrad.addColorStop(1, bgColor);
  ctx.fillStyle = radGrad;
  ctx.fillRect(0, 0, width, height);

  // 2. Draw Elegant Border Frame
  ctx.strokeStyle = goldColor;
  ctx.lineWidth = 3;
  ctx.strokeRect(60, 60, width - 120, height - 120);

  ctx.strokeStyle = isDark ? 'rgba(229,179,105,0.3)' : 'rgba(155,34,38,0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(74, 74, width - 148, height - 148);

  // Corner Ornaments
  drawCornerFloral(ctx, 60, 60, 1, 1, goldColor);
  drawCornerFloral(ctx, width - 60, 60, -1, 1, goldColor);
  drawCornerFloral(ctx, 60, height - 60, 1, -1, goldColor);
  drawCornerFloral(ctx, width - 60, height - 60, -1, -1, goldColor);

  // 3. Header / Branding
  ctx.font = '28px serif';
  ctx.fillStyle = accentColor;
  ctx.textAlign = 'center';
  ctx.fillText('❦  काव्य-कुंज  ❦', width / 2, 140);

  ctx.font = 'italic 20px sans-serif';
  ctx.fillStyle = mutedColor;
  ctx.fillText('मेरी क़लम से • ' + poem.category, width / 2, 175);

  // 4. Poem Title
  ctx.font = 'bold 54px serif';
  ctx.fillStyle = textColor;
  ctx.fillText(poem.title, width / 2, 260);

  // Divider Line
  ctx.strokeStyle = goldColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 120, 295);
  ctx.lineTo(width / 2 + 120, 295);
  ctx.stroke();

  // 5. Stanzas / Verses (Draw 1 or 2 core stanzas)
  ctx.font = '38px serif';
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';

  const linesToDraw = [];
  if (poem.stanzas && poem.stanzas.length > 0) {
    poem.stanzas[0].forEach(l => linesToDraw.push(l));
    if (poem.stanzas[1]) {
      linesToDraw.push("❦");
      poem.stanzas[1].slice(0, 2).forEach(l => linesToDraw.push(l));
    }
  }

  let startY = 400;
  const lineHeight = 64;
  linesToDraw.forEach(line => {
    if (line === "❦") {
      ctx.fillStyle = goldColor;
      ctx.font = '28px serif';
      ctx.fillText(line, width / 2, startY);
      ctx.fillStyle = textColor;
      ctx.font = '38px serif';
      startY += lineHeight - 10;
    } else {
      ctx.fillText(line, width / 2, startY);
      startY += lineHeight;
    }
  });

  // 6. Footer / Signature
  ctx.font = 'bold 24px sans-serif';
  ctx.fillStyle = accentColor;
  ctx.fillText('काव्य-कुंज डायरी', width / 2, height - 130);

  ctx.font = '18px sans-serif';
  ctx.fillStyle = mutedColor;
  ctx.fillText('दिल के अल्फ़ाज़, रूह की ज़ुबाँ', width / 2, height - 100);

  // Convert to image and prompt download
  const link = document.createElement('a');
  link.download = `${poem.id}-card.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  showToast('कलात्मक कार्ड डाउनलोड हो गया है! 📸');
}

function drawCornerFloral(ctx, x, y, dirX, dirY, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.arc(x + dirX * 24, y + dirY * 24, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x, y + dirY * 30);
  ctx.quadraticCurveTo(x + dirX * 30, y + dirY * 30, x + dirX * 30, y);
  ctx.stroke();

  ctx.restore();
}

// ---------------- Pure Web Audio API Ambiance Generator ----------------
// Generates gentle rain or peaceful Tanpura drone purely in-browser! Zero external MP3s!
let audioCtx = null;
let rainNode = null;
let tanpuraNodes = [];

function initAmbianceAudio() {
  const btn = document.getElementById('ambianceBtn');
  const icon = document.getElementById('ambianceIcon');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    if (state.ambiance === 'off') {
      state.ambiance = 'rain';
      startRainAudio();
      btn.classList.add('active');
      if (icon) icon.textContent = '🌧️';
      btn.title = 'माहौल: बारिश (क्लिक करके तानपुरा सुनें)';
      showToast('माहौल: सौंधी बारिश की फुहारें');
    } else if (state.ambiance === 'rain') {
      stopAmbiance();
      state.ambiance = 'tanpura';
      startTanpuraAudio();
      btn.classList.add('active');
      if (icon) icon.textContent = '🪕';
      btn.title = 'माहौल: तानपुरा (क्लिक करके बंद करें)';
      showToast('माहौल: ध्यानमग्न तानपुरा धुन');
    } else {
      stopAmbiance();
      state.ambiance = 'off';
      btn.classList.remove('active');
      if (icon) icon.textContent = '🎵';
      btn.title = 'माहौल ध्वनि (बारिश / तानपुरा)';
      showToast('माहौल: शांत');
    }
  });
}

function startRainAudio() {
  if (!audioCtx) return;
  const bufferSize = audioCtx.sampleRate * 2;
  const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  
  // Pink-like soothing noise
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04;
    b6 = white * 0.115926;
  }

  const whiteNoise = audioCtx.createBufferSource();
  whiteNoise.buffer = noiseBuffer;
  whiteNoise.loop = true;

  // Filter for rain softness
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(800, audioCtx.currentTime);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.01, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 1.5);

  whiteNoise.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);

  whiteNoise.start();
  rainNode = { source: whiteNoise, gain: gain };
}

function startTanpuraAudio() {
  if (!audioCtx) return;
  tanpuraNodes = [];

  // Sa-Pa notes (C3, G3, C4)
  const freqs = [130.81, 196.00, 261.63];
  const masterGain = audioCtx.createGain();
  masterGain.gain.setValueAtTime(0.01, audioCtx.currentTime);
  masterGain.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 1.5);
  masterGain.connect(audioCtx.destination);

  freqs.forEach((freq, idx) => {
    const osc = audioCtx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

    // Subtle tremolo LFO
    const lfo = audioCtx.createOscillator();
    lfo.frequency.setValueAtTime(0.2 + idx * 0.1, audioCtx.currentTime);
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.setValueAtTime(0.04, audioCtx.currentTime);

    const oscGain = audioCtx.createGain();
    oscGain.gain.setValueAtTime(0.08, audioCtx.currentTime);

    lfo.connect(oscGain.gain);
    osc.connect(oscGain);
    oscGain.connect(masterGain);

    osc.start();
    lfo.start();
    tanpuraNodes.push(osc, lfo);
  });
}

function stopAmbiance() {
  if (rainNode) {
    try {
      rainNode.gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
      setTimeout(() => rainNode.source.stop(), 500);
    } catch(e) {}
    rainNode = null;
  }
  if (tanpuraNodes.length > 0) {
    try {
      tanpuraNodes.forEach(node => node.stop());
    } catch(e) {}
    tanpuraNodes = [];
  }
}

// ---------------- Compose / Add New Poem ----------------
function openComposeModal() {
  const modal = document.getElementById('composeModal');
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeComposeModal() {
  const modal = document.getElementById('composeModal');
  if (modal) {
    modal.classList.remove('active');
  }
  document.body.style.overflow = '';
}

function handleSavePoem(e) {
  e.preventDefault();
  const title = document.getElementById('newPoemTitle').value.trim();
  const translit = document.getElementById('newPoemTranslit').value.trim();
  const category = document.getElementById('newPoemCategory').value;
  const tag = document.getElementById('newPoemTag').value.trim() || 'भावनाएँ';
  const content = document.getElementById('newPoemContent').value.trim();
  const essence = document.getElementById('newPoemEssence').value.trim();

  if (!title || !content) {
    showToast('कृपया शीर्षक और पंक्तियाँ अवश्य भरें!');
    return;
  }

  // Parse stanzas (separated by double newlines or blank lines)
  const rawStanzas = content.split(/\n\s*\n/);
  const stanzas = rawStanzas.map(s => s.split('\n').map(l => l.trim()).filter(Boolean));

  const newPoem = {
    id: 'user-' + Date.now(),
    title,
    transliteration: translit || title,
    category,
    tag,
    date: new Date().toLocaleDateString('hi-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
    readTime: '2 मिनट',
    excerpt: stanzas[0] ? stanzas[0].slice(0, 2).join(' ') : '',
    stanzas,
    glossary: [],
    essence
  };

  state.customPoems.unshift(newPoem);
  localStorage.setItem('kavya_custom_poems', JSON.stringify(state.customPoems));

  closeComposeModal();
  document.getElementById('composeForm').reset();
  showToast('आपकी नई रचना सफलतापूर्वक प्रकाशित हुई! 🪶');
  renderPoems();
}

// ---------------- Event Listeners ----------------
function initEventListeners() {
  // Search input
  const searchInput = document.getElementById('poemSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderPoems();
    });
  }

  // Compose button in header
  const composeBtn = document.getElementById('composeBtn');
  if (composeBtn) {
    composeBtn.addEventListener('click', openComposeModal);
  }

  // Compose Form submit
  const composeForm = document.getElementById('composeForm');
  if (composeForm) {
    composeForm.addEventListener('submit', handleSavePoem);
  }

  // Modal Close buttons
  const closePoemBtn = document.getElementById('closePoemBtn');
  if (closePoemBtn) closePoemBtn.addEventListener('click', closePoemModal);

  const closeComposeBtn = document.getElementById('closeComposeBtn');
  if (closeComposeBtn) closeComposeBtn.addEventListener('click', closeComposeModal);

  // Recite Button
  const reciteBtn = document.getElementById('recitePoemBtn');
  if (reciteBtn) reciteBtn.addEventListener('click', toggleRecitation);

  // Font Size Adjusters
  const fontDecBtn = document.getElementById('fontDecBtn');
  const fontIncBtn = document.getElementById('fontIncBtn');
  if (fontDecBtn) fontDecBtn.addEventListener('click', () => adjustFontSize(-0.1));
  if (fontIncBtn) fontIncBtn.addEventListener('click', () => adjustFontSize(0.1));

  // Modal backdrop click to close
  const modals = document.querySelectorAll('.modal-backdrop');
  modals.forEach(m => {
    m.addEventListener('click', (e) => {
      if (e.target === m) {
        closePoemModal();
        closeComposeModal();
      }
    });
  });

  // ESC key to close modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePoemModal();
      closeComposeModal();
    }
  });

  // Smooth scroll links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  // Mobile menu button
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', toggleMobileMenu);
  }
}

// ---------------- Mobile Menu Drawer ----------------
function toggleMobileMenu() {
  const drawer = document.getElementById('mobileNavDrawer');
  if (drawer) {
    drawer.classList.toggle('active');
  }
}

// ---------------- Toast Notification Utility ----------------
function showToast(message) {
  let toast = document.getElementById('toastNotification');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toastNotification';
    toast.className = 'toast-notification';
    document.body.appendChild(toast);
  }

  toast.innerHTML = `<span>❦</span> <span>${message}</span>`;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}
