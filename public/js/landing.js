const WA_CHANNEL_URL = 'https://whatsapp.com/channel/0029VbDKKpk6LwHkzWvLyk3e';
const SHARE_GOAL = 5; // shares needed before the "Share" step counts as done

// Set when a shared permalink sent the visitor here to do the tasks
const params = new URLSearchParams(location.search);
const unlockSlug = params.get('unlock');
const unlockExpired = params.get('expired') === '1';
let reopening = false;

const state = {
  joined: false,
  shares: 0
};

// The server keeps task progress in the session, so the same person who
// finishes the tasks here can open /<slug> without repeating them.
function applyTasks(s) {
  state.joined = !!s.joined;
  state.shares = Math.min(SHARE_GOAL, Number(s.shares) || 0);
}

async function syncTasks() {
  try {
    const r = await fetch('/api/unlock');
    if (r.ok) applyTasks(await r.json());
  } catch (e) { /* offline: keep current state */ }
}

function sharesComplete() { return state.shares >= SHARE_GOAL; }

function setShareProgress() {
  const pct = Math.round((state.shares / SHARE_GOAL) * 100);
  const bar = document.getElementById('shareBar');
  const txt = document.getElementById('shareProgressText');
  if (bar) bar.style.width = pct + '%';
  if (txt) {
    txt.textContent = pct >= 100
      ? '✅ Share complete — thank you!'
      : `${state.shares} of ${SHARE_GOAL} shares — ${pct}%`;
    txt.style.color = pct >= 100 ? '#008751' : '#0b3d2e';
  }
}

function setProgress() {
  const bar = document.getElementById('progressBar');
  const txt = document.getElementById('progressText');
  const s1 = document.getElementById('s1'), s2 = document.getElementById('s2'), s3 = document.getElementById('s3');
  const shared = sharesComplete();
  let pct = 0;
  s1.classList.toggle('active', true);
  s2.classList.toggle('active', shared);
  s3.classList.toggle('active', state.joined && shared);
  if (state.joined) pct += 40;
  if (shared) pct += 40;
  if (state.joined && shared) pct = 100;
  bar.style.width = pct + '%';
  if (pct === 0) txt.textContent = 'Not started';
  else if (pct === 40) txt.textContent = state.joined
    ? `Joined ✓ — now share ${SHARE_GOAL} times to unlock`
    : `Shared ✓ — now join to unlock`;
  else if (pct === 80) txt.textContent = 'Almost there…';
  else {
    txt.textContent = unlockSlug
      ? '✅ All steps complete — opening your content…'
      : '✅ All steps complete — reward unlocked!';
    loadRewards();
    if (unlockSlug && !reopening) {
      reopening = true;
      setTimeout(() => location.replace('/' + encodeURIComponent(unlockSlug)), 700);
    }
  }
}

async function refreshStats() {
  try {
    const r = await fetch('/api/stats'); const s = await r.json();
    animateNumber('weekCounter', s.week_joins);
    animateNumber('totalCounter', s.total_joins);
    animateNumber('downloadCounter', s.reward_downloads);
    document.getElementById('testimonialCount').textContent = s.testimonials_count;
    document.getElementById('likeCount').textContent = (s.total_joins * 3 + 128).toLocaleString();
  } catch (e) { /* offline ok */ }
}

function animateNumber(id, target) {
  const el = document.getElementById(id);
  const start = parseInt(el.textContent.replace(/,/g,'')) || 0;
  const dur = 800; const t0 = performance.now();
  function tick(t) {
    const k = Math.min(1, (t - t0) / dur);
    const v = Math.round(start + (target - start) * k);
    el.textContent = v.toLocaleString();
    if (k < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

document.getElementById('joinWaBtn').addEventListener('click', async () => {
  // Open immediately, still inside the user gesture, so popup blockers don't kill it
  window.open(WA_CHANNEL_URL, '_blank', 'noopener');
  state.joined = true;
  setProgress();
  try {
    const r = await fetch('/api/join-click', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ source: 'landing_wa' }) });
    if (r.ok) { applyTasks(await r.json()); setProgress(); }
  } catch (e) { /* offline */ }
  refreshStats();
});

const SHARE_TEXT = [
  '📚 Free WAEC/NECO/JAMB — join our WhatsApp channel for REAL questions & study guides.',
  '',
  `👉 Channel: ${WA_CHANNEL_URL}`,
  '',
  'Or learn more:',
  location.origin + '/',
  '',
  'Join our channel for weekly free giveaway(#50k) & challenges'
].join('\n');

/* ---------- SHARING ---------- */
const SHARE_DELAY = 6; // seconds before a share is counted (server demands 5)
let shareBusy = false;

function toast(message, ms) {
  let el = document.getElementById('ebToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ebToast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = 'show';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = ''; }, ms || 7000);
}

/* WhatsApp's own protocol keeps the message; https://wa.me/ tends to drop it
   and land on the app's home screen. The text is also copied as a safety net. */
function openWhatsAppShare(text) {
  const encoded = encodeURIComponent(text);

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast('✅ Message copied — paste it in the chat if WhatsApp opens empty.'),
      () => {}
    );
  }

  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    location.href = 'whatsapp://send?text=' + encoded;
    return;
  }

  const link = document.createElement('a');
  link.href = 'whatsapp://send?text=' + encoded;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // No app answered? Open WhatsApp Web in a tab instead.
  setTimeout(() => {
    if (document.visibilityState === 'visible' && document.hasFocus()) {
      window.open('https://web.whatsapp.com/send?text=' + encoded, '_blank', 'noopener');
    }
  }, 1500);
}

document.getElementById('shareBtn').addEventListener('click', () => {
  if (shareBusy) return;
  openWhatsAppShare(SHARE_TEXT);
  startShareCountdown();
});

function startShareCountdown() {
  shareBusy = true;
  const btn = document.getElementById('shareBtn');
  if (!btn.dataset.label) btn.dataset.label = btn.textContent;
  btn.disabled = true;
  let left = SHARE_DELAY;
  btn.textContent = `↗ Sharing… ${left}s`;

  const tick = setInterval(() => {
    left -= 1;
    if (left > 0) { btn.textContent = `↗ Sharing… ${left}s`; return; }
    clearInterval(tick);
    btn.textContent = btn.dataset.label;
    btn.disabled = false;
    shareBusy = false;
    recordShare();
  }, 1000);
}

async function recordShare() {
  try {
    const r = await fetch('/api/share-click', { method: 'POST' });
    if (r.status === 429) {
      const j = await r.json().catch(() => ({}));
      toast('⏳ Please wait ' + Math.ceil((j.wait_ms || 5000) / 1000) + 's before sharing again.');
      return;
    }
    if (r.ok) {
      applyTasks(await r.json());
      setShareProgress();
      setProgress();
    }
  } catch (e) { /* offline: the share sheet still opened */ }
}

async function loadTestimonials() {
  try {
    const r = await fetch('/api/testimonials'); const list = await r.json();
    const box = document.getElementById('testimonialList');
    box.innerHTML = list.length
      ? list.map(t => `<div class="testimonial"><b>${esc(t.name)}</b>${t.exam?`<span class="exam">${esc(t.exam)}</span>`:''} — ${esc(t.text)}</div>`).join('')
      : '<p class="note">No reviews yet — be the first!</p>';
  } catch(e) { document.getElementById('testimonialList').innerHTML = '<p class="note">Could not load reviews.</p>'; }
}

async function loadRewards() {
  try {
    const r = await fetch('/api/rewards'); const list = await r.json();
    const box = document.getElementById('rewardContent');
    box.innerHTML = list.length
      ? `<p class="note" style="text-align:left;margin-bottom:10px;">${list.length} content pack${list.length > 1 ? 's' : ''} available — tap one to open it.</p>`
        + list.map(x => `
          <a class="content-link" href="/${esc(x.slug)}">
            <span>${esc(x.title)}</span>
            <small>${[x.exam, x.files ? `${x.files} file${x.files > 1 ? 's' : ''}` : ''].filter(Boolean).map(esc).join(' · ')}</small>
          </a>`).join('')
      : '<p class="note">No content uploaded yet. Check back soon.</p>';
  } catch(e) { document.getElementById('rewardContent').innerHTML = '<p class="note">Could not load content.</p>'; }
}

function isImage(src) { return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(src || ''); }

async function trackDownload() {
  try { await fetch('/api/reward-download', { method:'POST' }); refreshStats(); } catch(e){}
}
window.trackDownload = trackDownload;

document.getElementById('submitTestimonial').addEventListener('click', async () => {
  const name = document.getElementById('tName').value.trim();
  const text = document.getElementById('tText').value.trim();
  const exam = document.getElementById('tExam').value;
  const msg = document.getElementById('tMsg');
  if (!name || !text) { msg.textContent = 'Please fill name and experience.'; return; }
  try {
    const r = await fetch('/api/testimonials', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, text, exam }) });
    if (r.ok) { msg.textContent = '✅ Submitted! Will appear after review.'; document.getElementById('tName').value=''; document.getElementById('tText').value=''; }
    else msg.textContent = 'Something went wrong.';
  } catch(e) { msg.textContent = 'Network error.'; }
});

function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function showUnlockNotice() {
  if (!unlockSlug) return;
  let title = '';
  try {
    const list = await (await fetch('/api/rewards')).json();
    const item = Array.isArray(list) ? list.find(x => x.slug === unlockSlug) : null;
    if (!item) return; // content removed — nothing to explain
    title = item.title;
  } catch (e) { return; }

  const box = document.createElement('div');
  box.className = 'unlock-notice';
  box.innerHTML =
    '<b>🔒 ' + esc(title) + ' is locked</b>' +
    '<span>Join the channel and share this page 5 times — the content opens by itself.</span>' +
    (unlockExpired ? '<span class="unlock-expired">⏰ Your previous access expired, so the steps are needed again.</span>' : '');
  const anchor = document.getElementById('rewardContent');
  anchor.parentNode.insertBefore(box, anchor);
}

// init
setShareProgress();
syncTasks().then(() => {
  setShareProgress();
  setProgress();
  if (unlockSlug && !(state.joined && sharesComplete())) showUnlockNotice();
});
refreshStats(); loadTestimonials();
setInterval(refreshStats, 15000);
