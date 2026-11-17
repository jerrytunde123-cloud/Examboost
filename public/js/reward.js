const slug = decodeURIComponent(location.pathname.replace(/^\/+/, '').replace(/\/+$/, ''));

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isImage(src) { return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(src || ''); }

async function trackDownload() {
  try { await fetch('/api/reward-download', { method: 'POST' }); } catch (e) {}
}
window.trackDownload = trackDownload;

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

async function load() {
  const box = document.getElementById('content');
  try {
    const r = await fetch('/api/rewards/' + encodeURIComponent(slug));
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
