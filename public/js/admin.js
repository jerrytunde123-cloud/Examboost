const $ = id => document.getElementById(id);
let authed = false;

async function checkAuth() {
  const r = await fetch('/api/admin/me');
  if (r.ok) { authed = true; showDash(); }
}

$('loginBtn').addEventListener('click', async () => {
  const r = await fetch('/api/admin/login', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ username: $('u').value, password: $('p').value })
  });
  if (r.ok) { authed = true; showDash(); }
  else $('loginMsg').textContent = 'Invalid credentials';
});

$('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method:'POST' });
  location.reload();
});

function showDash() {
  $('loginBox').classList.add('hidden');
  $('dash').classList.remove('hidden');
  loadAll();
  setInterval(loadStats, 10000);
}

async function loadStats() {
  const r = await fetch('/api/admin/stats'); const s = await r.json();
  $('stWeek').textContent = s.week_joins;
  $('stTotal').textContent = s.total_joins;
  $('stDl').textContent = s.reward_downloads;
  $('st24').textContent = s.join_clicks_24h;
  $('stPending').textContent = s.pending_testimonials;
}

async function loadRewards() {
  const r = await fetch('/api/admin/rewards'); const list = await r.json();
  const tb = $('rewardTable').querySelector('tbody');
  tb.innerHTML = list.map(x => `
    <tr>
      <td>${esc(x.title)}</td>
      <td>${esc(x.exam||'—')}</td>
      <td><span class="badge ${x.active?'approved':'pending'}">${x.active?'Active':'Hidden'}</span></td>
      <td>
        <button class="ghost" onclick="toggleReward(${x.id}, ${x.active?0:1})">${x.active?'Hide':'Show'}</button>
        <button class="danger" onclick="delReward(${x.id})">Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" style="color:#888;">No rewards yet.</td></tr>';
}

async function loadTestimonials() {
  const r = await fetch('/api/admin/testimonials'); const list = await r.json();
  const tb = $('testiTable').querySelector('tbody');
  tb.innerHTML = list.map(x => `
    <tr>
      <td>${esc(x.name)}</td>
      <td>${esc(x.exam||'—')}</td>
      <td style="max-width:280px;">${esc(x.text)}</td>
      <td><span class="badge ${x.approved?'approved':'pending'}">${x.approved?'Approved':'Pending'}</span></td>
      <td>
        <button class="ghost" onclick="toggleTesti(${x.id}, ${x.approved?0:1})">${x.approved?'Unapprove':'Approve'}</button>
        <button class="danger" onclick="delTesti(${x.id})">Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" style="color:#888;">No testimonials yet.</td></tr>';
}

$('uploadRewardBtn').addEventListener('click', async () => {
  const fd = new FormData();
  fd.append('title', $('rTitle').value);
  fd.append('description', $('rDesc').value);
  fd.append('exam', $('rExam').value);
  fd.append('link', $('rLink').value);
  const f = $('rFile').files[0]; if (f) fd.append('file', f);
  const r = await fetch('/api/admin/rewards', { method:'POST', body: fd });
  if (r.ok) {
    $('rMsg').textContent = '✅ Uploaded.';
    $('rTitle').value=$('rDesc').value=$('rLink').value=''; $('rFile').value='';
    loadRewards();
  } else $('rMsg').textContent = 'Upload failed.';
});

async function toggleReward(id, active) {
  await fetch('/api/admin/rewards/'+id, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({active: !!active}) });
  loadRewards();
}
async function delReward(id) {
  if (!confirm('Delete this reward?')) return;
  await fetch('/api/admin/rewards/'+id, { method:'DELETE' });
  loadRewards();
}
async function toggleTesti(id, approved) {
  await fetch('/api/admin/testimonials/'+id, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({approved: !!approved}) });
  loadTestimonials();
}
async function delTesti(id) {
  if (!confirm('Delete this testimonial?')) return;
  await fetch('/api/admin/testimonials/'+id, { method:'DELETE' });
  loadTestimonials();
}
window.toggleReward=toggleReward; window.delReward=delReward; window.toggleTesti=toggleTesti; window.delTesti=delTesti;

function loadAll(){ loadStats(); loadRewards(); loadTestimonials(); }
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

checkAuth();
