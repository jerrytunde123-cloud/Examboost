const WA_CHANNEL_URL = 'https://whatsapp.com/channel/0029VbDKKpk6LwHkzWvLyk3e';
const SHARE_GOAL = 5; // shares needed before the "Share" step counts as done

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
  else { txt.textContent = '✅ All steps complete — reward unlocked!'; loadRewards(); }
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

document.getElementById('shareBtn').addEventListener('click', () => {
  // Share synchronously first, while the browser still counts this as a user gesture
  if (navigator.share) {
    navigator.share({ title: 'EduBoost — Free Exam Prep', text: SHARE_TEXT }).catch(() => {});
  } else {
    window.open('https://wa.me/?text=' + encodeURIComponent(SHARE_TEXT), '_blank', 'noopener');
  }
  recordShare();
});

async function recordShare() {
  try {
    const r = await fetch('/api/share-click', { method: 'POST' });
    if (r.ok) {
      applyTasks(await r.json());
      setShareProgress();
      setProgress();
    }
  } catch (e) { /* offline: the click still opened the share sheet */ }
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

// init
setShareProgress();
syncTasks().then(() => { setShareProgress(); setProgress(); });
refreshStats(); loadTestimonials();
setInterval(refreshStats, 15000);
