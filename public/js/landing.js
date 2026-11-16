const WA_CHANNEL_URL = 'https://whatsapp.com/channel/REPLACE_WITH_YOUR_CHANNEL_ID';

const state = {
  joined: localStorage.getItem('eb_joined') === '1',
  shared: localStorage.getItem('eb_shared') === '1'
};

function setProgress() {
  const bar = document.getElementById('progressBar');
  const txt = document.getElementById('progressText');
  const s1 = document.getElementById('s1'), s2 = document.getElementById('s2'), s3 = document.getElementById('s3');
  let pct = 0;
  s1.classList.toggle('active', true);
  s2.classList.toggle('active', state.shared);
  s3.classList.toggle('active', state.joined && state.shared);
  if (state.joined) pct += 40;
  if (state.shared) pct += 40;
  if (state.joined && state.shared) pct = 100;
  bar.style.width = pct + '%';
  if (pct === 0) txt.textContent = 'Not started';
  else if (pct === 40) txt.textContent = state.joined ? 'Joined ✓ — now share to unlock' : 'Shared ✓ — now join to unlock';
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
  state.joined = true; localStorage.setItem('eb_joined', '1');
  setProgress();
  try { await fetch('/api/join-click', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ source: 'landing_wa' }) }); } catch(e){}
  window.open(WA_CHANNEL_URL, '_blank');
  refreshStats();
});

document.getElementById('shareBtn').addEventListener('click', async () => {
  state.shared = true; localStorage.setItem('eb_shared', '1');
  setProgress();
  const url = location.href;
  const text = 'Free WAEC/NECO/JAMB prep materials — join here:';
  if (navigator.share) {
    try { await navigator.share({ title: 'EduBoost', text, url }); } catch(e){}
  } else {
    window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank');
  }
});

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
      ? list.map(x => `
        <div class="reward-item">
          <h4>${esc(x.title)} ${x.exam?`<span class="exam">${esc(x.exam)}</span>`:''}</h4>
          <p>${esc(x.description||'')}</p>
          ${x.file_path?`<a href="${x.file_path}" target="_blank" onclick="trackDownload()">📄 Download</a> `:''}
          ${x.link?`<a href="${esc(x.link)}" target="_blank" onclick="trackDownload()">🔗 Open Link</a>`:''}
        </div>`).join('')
      : '<p class="note">No rewards uploaded yet. Check back soon.</p>';
  } catch(e) { document.getElementById('rewardContent').innerHTML = '<p class="note">Could not load rewards.</p>'; }
}

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
setProgress();
refreshStats(); loadTestimonials();
setInterval(refreshStats, 15000);
