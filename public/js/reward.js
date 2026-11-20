const WA_CHANNEL_URL = 'https://whatsapp.com/channel/0029VbDKKpk6LwHkzWvLyk3e';
const SHARE_GOAL = 5;

const slug = decodeURIComponent(location.pathname.replace(/^\/+/, '').replace(/\/+$/, ''));

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

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isImage(src) { return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(src || ''); }

async function trackDownload() {
  try { await fetch('/api/reward-download', { method: 'POST' }); } catch (e) {}
}
window.trackDownload = trackDownload;

/* Straight to WhatsApp, where the message can be sent to groups, friends
   and chats. The native share sheet often lists nothing useful. */
function openWhatsAppShare(text) {
  const url = 'https://wa.me/?text=' + encodeURIComponent(text);
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function render(item) {
  document.title = item.title + ' — EduBoost';
  const box = document.getElementById('content');
  const photos = (item.images || []).filter(isImage);
  const docs = (item.images || []).filter(s => !isImage(s));

  box.innerHTML = `
    <h1>${esc(item.title)}</h1>
    ${item.exam ? `<span class="exam">${esc(item.exam)}</span>` : ''}
    ${item.description ? `<div class="desc">${esc(item.description)}</div>` : ''}
    ${photos.length ? `<div class="gallery">${photos.map(src =>
        `<a href="${esc(src)}" target="_blank" rel="noopener" onclick="trackDownload()"><img src="${esc(src)}" alt="Attachment"></a>`
      ).join('')}</div>` : ''}
    ${docs.map((src, i) => `<a class="btn" href="${esc(src)}" target="_blank" rel="noopener" onclick="trackDownload()">📄 Download${docs.length > 1 ? ' ' + (i + 1) : ''}</a>`).join('')}
    ${item.link ? `<a class="btn btn-ghost" href="${esc(item.link)}" target="_blank" rel="noopener" onclick="trackDownload()">🔗 Open Link</a>` : ''}
    ${!photos.length && !docs.length && !item.link ? '<p class="note">No files attached to this content yet.</p>' : ''}
  `;
}

/* ---------- LOCKED STATE: the visitor must finish the tasks first ---------- */
function percent(shares) {
  return Math.round((Math.min(Number(shares) || 0, SHARE_GOAL) / SHARE_GOAL) * 100);
}

// The join/share endpoints return progress only, so remember what is being
// unlocked — otherwise the card loses its title after every click.
let gateInfo = { title: '', exam: null, files: 0 };

function renderGate(box, s) {
  if (s.title) gateInfo.title = s.title;
  if (s.exam !== undefined) gateInfo.exam = s.exam;
  if (s.files) gateInfo.files = s.files;

  const pct = percent(s.shares);
  const hours = s.ttl_hours || 24;
  document.title = 'Unlock ' + (gateInfo.title || 'this content') + ' — EduBoost';

  box.innerHTML = `
    <h1>🔒 This content is locked</h1>
    ${s.expired ? '<p class="expired">⏰ Your previous access has expired — complete the steps again to reopen it.</p>' : ''}
    <p class="desc" style="margin-bottom:6px;">
      <b>${esc(gateInfo.title || 'This material')}</b>
      ${gateInfo.exam ? `<span class="exam">${esc(gateInfo.exam)}</span>` : ''}
      ${gateInfo.files ? `<span class="note">${gateInfo.files} file${gateInfo.files > 1 ? 's' : ''}</span>` : ''}
    </p>
    <p class="note" style="margin-bottom:16px;">
      Complete both steps below to open it — it takes less than a minute.
    </p>

    <div class="task${s.joined ? ' done' : ''}">
      <div class="task-text">
        <b>1. Join our WhatsApp channel</b><br>
        <span class="note">Free questions, study guides and weekly giveaways.</span>
      </div>
      <button class="btn" id="gateJoinBtn">${s.joined ? '✓ Joined' : 'Join channel'}</button>
    </div>

    <div class="task${pct >= 100 ? ' done' : ''}">
      <div class="task-text">
        <b>2. Share this page (${Math.min(Number(s.shares) || 0, SHARE_GOAL)}/${SHARE_GOAL})</b><br>
        <span class="note">Share to 5 groups, friends &amp; classmates.</span>
      </div>
      <button class="btn" id="gateShareBtn">Share</button>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <span class="note" style="flex:0 0 100%;">${pct >= 100 ? '✅ Share complete' : pct + '% complete'}</span>
    </div>

    <p class="note" id="gateMsg"></p>
    <p class="note" style="margin-top:8px;">Access lasts ${hours} hours, then the steps are required again.</p>
    <p style="margin-top:14px;"><a class="btn" href="/?unlock=${encodeURIComponent(slug)}">Go to the homepage to unlock →</a></p>
    <p style="margin-top:6px;"><a class="back" href="/">← See all available content</a></p>
  `;

  const msg = document.getElementById('gateMsg');
  if (s.joined && pct < 100) msg.textContent = 'Step 1 done — now share 5 times to unlock.';
  else if (!s.joined && pct >= 100) msg.textContent = 'Step 2 done — now join the channel to unlock.';

  const joinBtn = document.getElementById('gateJoinBtn');
  if (joinBtn) joinBtn.addEventListener('click', async () => {
    // Open inside the click gesture so popup blockers leave it alone
    window.open(WA_CHANNEL_URL, '_blank', 'noopener');
    if (msg) msg.textContent = 'Opening the channel…';
    try {
      const r = await fetch('/api/join-click', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'permalink_gate' })
      });
      if (r.ok) return applyState(await r.json());
    } catch (e) {}
    if (msg) msg.textContent = 'Could not reach the server. Check your connection and try again.';
  });

  const shareBtn = document.getElementById('gateShareBtn');
  if (shareBtn) shareBtn.addEventListener('click', () => {
    openWhatsAppShare(SHARE_TEXT);
    recordShare();
  });
}

async function recordShare() {
  try {
    const r = await fetch('/api/share-click', { method: 'POST' });
    if (!r.ok) return;
    const s = await r.json();

    // If the browser is dropping the session cookie, progress would silently
    // restart at 1 every click. Say so instead of looping forever.
    try {
      const check = await (await fetch('/api/unlock')).json();
      if (!check.unlocked && check.shares !== s.shares) {
        const msg = document.getElementById('gateMsg');
        if (msg) msg.innerHTML = '⚠️ This browser is not keeping your progress. Open the link in Chrome or Safari (not a private tab) and try again.';
        return;
      }
    } catch (e) {}

    applyState(s);
  } catch (e) {}
}

function applyState(s) {
  if (s && s.unlocked) return load();
  renderGate(document.getElementById('content'), s || { joined: false, shares: 0, needed: SHARE_GOAL });
}

/* ---------- LOAD ---------- */
async function load() {
  const box = document.getElementById('content');
  const preview = new URLSearchParams(location.search).get('preview') === '1' ? '?preview=1' : '';
  try {
    const r = await fetch('/api/rewards/' + encodeURIComponent(slug) + preview);
    if (r.status === 403) return applyState(await r.json());
    if (!r.ok) {
      box.innerHTML = `<h1>Content not found</h1><p class="note">This link may have been removed or the title was changed.</p>
        <p><a class="btn" href="/">See all available content</a></p>`;
      return;
    }
    render(await r.json());
  } catch (e) {
    box.innerHTML = '<h1>Could not load this content</h1><p class="note">Check your connection and try again.</p>';
  }
}

load();
