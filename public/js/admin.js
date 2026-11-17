const $ = id => document.getElementById(id);
let authed = false;
let rewardsCache = [];
let testiCache = [];

const EXAMS = ['WAEC', 'NECO', 'JAMB', 'POST-UTME', 'NECO GCE', 'WAEC GCE', 'NABTEB', 'JUPEB', 'IJMB', 'BECE', 'Unified', 'Other'];
const MAX_FILES = 30;

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

/* ---------- REWARDS TABLE ---------- */
async function loadRewards() {
  const r = await fetch('/api/admin/rewards'); const list = await r.json();
  rewardsCache = list;
  const tb = $('rewardTable').querySelector('tbody');
  tb.innerHTML = list.map(x => `
    <tr>
      <td>${esc(x.title)}</td>
      <td>${esc(x.exam || '—')}</td>
      <td>${(x.images || []).length}</td>
      <td><span class="badge ${x.active ? 'approved' : 'pending'}">${x.active ? 'Active' : 'Hidden'}</span></td>
      <td>
        <a class="permalink" href="/${esc(x.slug)}" target="_blank" rel="noopener">/${esc(x.slug)}</a>
        <button class="ghost copy" onclick="copyLink('/${esc(x.slug)}')">Copy</button>
      </td>
      <td>
        <button class="ghost" onclick="editReward(${x.id})">Edit</button>
        <button class="ghost" onclick="toggleReward(${x.id}, ${x.active ? 0 : 1})">${x.active ? 'Hide' : 'Show'}</button>
        <button class="danger" onclick="delReward(${x.id})">Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" style="color:#888;">No rewards yet.</td></tr>';
}

async function copyLink(path) {
  const full = location.origin + path;
  try { await navigator.clipboard.writeText(full); }
  catch (e) {
    const t = document.createElement('textarea');
    t.value = full; document.body.appendChild(t); t.select();
    document.execCommand('copy'); t.remove();
  }
  alert('Link copied:\n' + full);
}

/* ---------- TESTIMONIALS TABLE ---------- */
async function loadTestimonials() {
  const r = await fetch('/api/admin/testimonials'); const list = await r.json();
  testiCache = list;
  const tb = $('testiTable').querySelector('tbody');
  tb.innerHTML = list.map(x => `
    <tr>
      <td>${esc(x.name)}</td>
      <td>${esc(x.exam || '—')}</td>
      <td class="desc" title="${esc(x.text)}">${esc(x.text)}</td>
      <td><span class="badge ${x.approved ? 'approved' : 'pending'}">${x.approved ? 'Approved' : 'Pending'}</span></td>
      <td>
        <button class="ghost" onclick="editTesti(${x.id})">Edit</button>
        <button class="ghost" onclick="toggleTesti(${x.id}, ${x.approved ? 0 : 1})">${x.approved ? 'Unapprove' : 'Approve'}</button>
        <button class="danger" onclick="delTesti(${x.id})">Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" style="color:#888;">No testimonials yet.</td></tr>';
}

/* ---------- UPLOAD (up to 30 files) ---------- */
/* A single request body is capped at 4.5 MB on Vercel, so files are sent in
   batches that stay safely under it. Each batch goes to the same endpoints. */
const MAX_BATCH_BYTES = 3.5 * 1024 * 1024;
const MAX_BATCH_FILES = 6;

function batchFiles(files) {
  const batches = [];
  let cur = [], bytes = 0;
  for (const f of files) {
    if (cur.length && (bytes + f.size > MAX_BATCH_BYTES || cur.length >= MAX_BATCH_FILES)) {
      batches.push(cur); cur = []; bytes = 0;
    }
    cur.push(f); bytes += f.size;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

async function postFiles(url, fields, files) {
  const fd = new FormData();
  for (const k of Object.keys(fields || {})) fd.append(k, fields[k]);
  (files || []).forEach(f => fd.append('files', f));
  const r = await fetch(url, { method: 'POST', body: fd });
  let json = {};
  try { json = await r.json(); } catch (e) {}
  return { ok: r.ok, json, status: r.status };
}

function uploadErrorText(r) {
  if (r.json && r.json.error) return r.json.error;
  if (r.status === 413) return 'the file(s) are too large to upload in one request.';
  return 'server returned ' + r.status + '.';
}

$('uploadRewardBtn').addEventListener('click', async () => {
  const title = $('rTitle').value.trim();
  if (!title) { $('rMsg').textContent = 'Title is required.'; return; }
  const files = Array.from($('rFile').files || []);
  if (files.length > MAX_FILES) { $('rMsg').textContent = `Too many files — ${MAX_FILES} maximum.`; return; }

  const meta = {
    title,
    description: $('rDesc').value,
    exam: $('rExam').value,
    link: $('rLink').value
  };
  const batches = batchFiles(files);

  $('rMsg').textContent = files.length ? `Uploading ${files.length} file(s)…` : 'Saving…';

  const first = batches.length
    ? await postFiles('/api/admin/rewards', meta, batches[0])
    : await postFiles('/api/admin/rewards', meta, []);

  if (!first.ok) {
    $('rMsg').textContent = 'Upload failed — ' + uploadErrorText(first);
    return;
  }

  const created = first.json;
  let count = (created.images || []).length;
  let failed = 0;

  for (let i = 1; i < batches.length; i++) {
    $('rMsg').textContent = `Uploading files… ${count}/${files.length}`;
    const r = await postFiles('/api/admin/rewards/' + created.id + '/images', {}, batches[i]);
    if (r.ok) count = (r.json.images || []).length;
    else failed += batches[i].length;
  }

  $('rMsg').textContent = failed
    ? `⚠️ Saved, but ${failed} file(s) could not be uploaded. Open "Edit" to add them again.`
    : `✅ Uploaded with ${count} file(s).`;

  $('rTitle').value = $('rDesc').value = $('rLink').value = '';
  $('rFile').value = '';
  loadRewards();
});

/* ---------- MODAL ---------- */
function openModal(title, bodyHTML) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = bodyHTML;
  $('modalMsg').textContent = '';
  $('modal').classList.remove('hidden');
}
function closeModal() {
  $('modal').classList.add('hidden');
  $('modalBody').innerHTML = '';
}
$('modalCancel').addEventListener('click', closeModal);
$('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function examOptions(selected) {
  return ['<option value="">Exam (optional)</option>']
    .concat(EXAMS.map(e => `<option value="${esc(e)}"${e === selected ? ' selected' : ''}>${esc(e)}</option>`))
    .join('');
}

/* ---------- EDIT REWARD ---------- */
function editReward(id) {
  const x = rewardsCache.find(r => r.id === id);
  if (!x) return;
  const assets = (x.images || []).map((src, i) => `
    <div class="asset">
      ${isImage(src)
        ? `<img class="thumb" src="${esc(src)}" alt="">`
        : `<div class="thumb-file" title="${esc(src)}">📄</div>`}
      <button onclick="removeRewardAsset(${x.id}, ${i})" title="Remove this file">×</button>
    </div>`).join('') || '<p class="hint">No files attached yet.</p>';

  openModal('Edit reward', `
    <input id="eTitle" placeholder="Title" value="${esc(x.title || '')}">
    <div class="slug-row">
      <span class="prefix">${esc(location.origin)}/</span>
      <input id="eSlug" placeholder="permalink" value="${esc(x.slug || '')}">
    </div>
    <p class="hint" style="margin-top:-4px;">This is the shareable link for this content. Lowercase letters, numbers and hyphens only — e.g. necogce-maths</p>
    <textarea id="eDesc" rows="8" placeholder="Description (any length)">${esc(x.description || '')}</textarea>
    <div class="row">
      <select id="eExam">${examOptions(x.exam)}</select>
      <input id="eLink" placeholder="External link (optional)" value="${esc(x.link || '')}">
    </div>
    <label class="chk"><input type="checkbox" id="eActive" ${x.active ? 'checked' : ''}> Visible on the landing page</label>
    <p class="hint" style="margin-top:10px;">Attached files (${(x.images || []).length}/${MAX_FILES})</p>
    <div class="asset-grid">${assets}</div>
    <p class="hint">Add more files</p>
    <input id="eFiles" type="file" multiple style="padding:6px;">
  `);

  $('modalSave').onclick = async () => {
    const title = $('eTitle').value.trim();
    if (!title) { $('modalMsg').textContent = 'Title is required.'; return; }

    const put = await fetch('/api/admin/rewards/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        slug: $('eSlug').value.trim(),
        description: $('eDesc').value,
        exam: $('eExam').value,
        link: $('eLink').value
      })
    });

    const wantActive = $('eActive').checked ? 1 : 0;
    if (wantActive !== (x.active ? 1 : 0)) {
      await fetch('/api/admin/rewards/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !!wantActive })
      });
    }

    const files = Array.from($('eFiles').files || []);
    if (files.length) {
      let count = (x.images || []).length;
      const batches = batchFiles(files);
      for (let i = 0; i < batches.length; i++) {
        if (batches.length > 1) $('modalMsg').textContent = `Uploading files… ${count}/${count + files.length}`;
        const up = await postFiles('/api/admin/rewards/' + id + '/images', {}, batches[i]);
        if (!up.ok) { $('modalMsg').textContent = 'Saved, but file upload failed — ' + uploadErrorText(up); loadRewards(); return; }
        count = (up.json.images || []).length;
      }
    }

    if (!put.ok) { $('modalMsg').textContent = 'Save failed.'; return; }
    closeModal();
    loadRewards();
  };
}

async function removeRewardAsset(id, index) {
  if (!confirm('Remove this file? It will be deleted from the server.')) return;
  await fetch(`/api/admin/rewards/${id}/images/${index}`, { method: 'DELETE' });
  await loadRewards();
  editReward(id);
}

/* ---------- EDIT TESTIMONIAL ---------- */
function editTesti(id) {
  const x = testiCache.find(t => t.id === id);
  if (!x) return;
  openModal('Edit testimonial', `
    <input id="etName" placeholder="Name" value="${esc(x.name || '')}">
    <select id="etExam">${examOptions(x.exam)}</select>
    <textarea id="etText" rows="8" placeholder="Testimonial text (any length)">${esc(x.text || '')}</textarea>
    <label class="chk"><input type="checkbox" id="etApproved" ${x.approved ? 'checked' : ''}> Approved (visible on the landing page)</label>
  `);

  $('modalSave').onclick = async () => {
    const name = $('etName').value.trim();
    const text = $('etText').value.trim();
    if (!name || !text) { $('modalMsg').textContent = 'Name and text are required.'; return; }
    const r = await fetch('/api/admin/testimonials/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, text, exam: $('etExam').value, approved: $('etApproved').checked })
    });
    if (!r.ok) { $('modalMsg').textContent = 'Save failed.'; return; }
    closeModal();
    loadTestimonials();
  };
}

/* ---------- TOGGLES / DELETE ---------- */
async function toggleReward(id, active) {
  await fetch('/api/admin/rewards/' + id, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({active: !!active}) });
  loadRewards();
}
async function delReward(id) {
  if (!confirm('Delete this reward and all its files?')) return;
  await fetch('/api/admin/rewards/' + id, { method:'DELETE' });
  loadRewards();
}
async function toggleTesti(id, approved) {
  await fetch('/api/admin/testimonials/' + id, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({approved: !!approved}) });
  loadTestimonials();
}
async function delTesti(id) {
  if (!confirm('Delete this testimonial?')) return;
  await fetch('/api/admin/testimonials/' + id, { method:'DELETE' });
  loadTestimonials();
}

window.toggleReward = toggleReward; window.delReward = delReward;
window.toggleTesti = toggleTesti; window.delTesti = delTesti;
window.editReward = editReward; window.editTesti = editTesti;
window.removeRewardAsset = removeRewardAsset; window.copyLink = copyLink;

function loadAll() { loadStats(); loadRewards(); loadTestimonials(); }
function isImage(src) { return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(src || ''); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

checkAuth();
