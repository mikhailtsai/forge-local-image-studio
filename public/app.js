const $ = id => document.getElementById(id);
const characterNegative = 'bad anatomy, bad hands, malformed hands, deformed hands, poorly drawn hands, poorly drawn fingers, malformed fingers, deformed fingers, extra fingers, missing fingers, fused fingers, webbed fingers, duplicated fingers, too many fingers, too few fingers, unnatural fingers, twisted fingers, tangled fingers, extra hands, missing hands, duplicated hands, malformed limbs, deformed limbs, extra limbs, missing limbs, disconnected limbs, twisted arms, broken wrists, unnatural pose, impossible pose, anatomical errors, distorted anatomy, mutated, disfigured, asymmetrical body, bad proportions, distorted face, deformed face, crossed eyes, low quality, worst quality, blurry, artifacts, jpeg artifacts, text symbols';
const negativeSets = { character: characterNegative, quality: 'low quality, worst quality, blurry, artifacts, jpeg artifacts, watermark, text, signature, compression, oversaturated, noisy', minimal: 'low quality, blurry, watermark' };
const promptSets = { portrait: 'editorial portrait of a confident subject, sculpted directional light, subtle film grain, refined styling, shallow depth of field, premium fashion photography', landscape: 'vast atmospheric landscape at blue hour, dramatic cloud formations, luminous horizon, cinematic composition, natural color grade, highly detailed', product: 'futuristic product on a dark reflective pedestal, precise studio lighting, elegant industrial design, soft volumetric haze, high-end campaign photography' };
let config, history = [], archive = [];
let stripPage = { limit: 8, offset: 0, total: 0, hasNext: false, hasPrevious: false };
let archivePage = { limit: 12, offset: 0, total: 0, hasNext: false, hasPrevious: false };
let archiveRequestToken = 0;

async function api(url, options) { const response = await fetch(url, options); const body = await response.json(); if (!response.ok) throw Error(body.error || 'Request failed'); return body; }
function setValue(id, value) { if (value !== undefined && value !== null) $(id).value = value; }
function fillSettings() {
  if (!config) return;
  const workflows = config.workflows || {}, model = $('model').value;
  const defaults = (workflows.defaults || {})[model] || {};
  for (const key of ['steps', 'cfg', 'seed', 'denoise', 'width', 'height', 'batch', 'shift']) setValue(key, defaults[key]);
  setValue('seed', '');
  $('sampler').innerHTML = (workflows.samplers || []).map(x => `<option>${escapeHtml(x)}</option>`).join('');
  $('scheduler').innerHTML = (workflows.schedulers || []).map(x => `<option>${escapeHtml(x)}</option>`).join('');
  setValue('sampler', defaults.sampler); setValue('scheduler', defaults.scheduler);
  $('shiftWrap').style.display = model === 'flux' ? 'block' : 'none';
}
function imagesFor(item) { return item.images?.length ? item.images : (item.image ? [item.image] : []); }
function dateFor(item) { return new Date(`${item.created_at}Z`).toLocaleString(); }

function renderStrip() {
  $('count').textContent = `${stripPage.total} SAVED`;
  const recent = history.flatMap(item => imagesFor(item).map(image => ({ item, image }))).slice(0, 8);
  $('history').innerHTML = recent.length ? recent.map(({ item, image }) => `<button class="thumb" data-id="${item.id}" title="${escapeHtml(item.model)} · ${dateFor(item)}"><img src="${image}" alt="Generated image"></button>`).join('') : (history.length ? `<div class="pending">${escapeHtml(history[0].status.toUpperCase())}</div>` : '<div class="empty-strip">No generations yet.</div>');
  document.querySelectorAll('#history [data-id]').forEach(el => el.onclick = () => openDetail(history.find(item => item.id == el.dataset.id)));
  const first = history.find(item => imagesFor(item).length);
  if (first) $('featured').innerHTML = imagesFor(first).map(image => `<img src="${image}" alt="Generated image" data-id="${first.id}">`).join('');
  document.querySelectorAll('#featured [data-id]').forEach(el => el.onclick = () => openDetail(history.find(item => item.id == el.dataset.id)));
}

function renderArchive() {
  $('archiveCount').textContent = `${archivePage.total} generation${archivePage.total === 1 ? '' : 's'}`;
  $('archivePageInfo').textContent = archivePage.total ? `SHOWING ${archivePage.offset + 1}–${Math.min(archivePage.offset + archive.length, archivePage.total)}` : 'EMPTY';
  $('archivePageLabel').textContent = `Page ${Math.floor(archivePage.offset / archivePage.limit) + 1}`;
  $('archivePrevious').disabled = !archivePage.hasPrevious; $('archiveNext').disabled = !archivePage.hasNext;
  $('archiveGrid').innerHTML = archive.length ? archive.map(item => {
    const image = imagesFor(item)[0];
    const params = Object.entries(item.params || {}).filter(([key]) => !['prompt', 'negative', 'model'].includes(key)).map(([key, value]) => `<span><b>${escapeHtml(key)}</b>${escapeHtml(value)}</span>`).join('');
    return `<article class="archive-card"><button class="archive-image" data-id="${item.id}" ${image ? '' : 'disabled'}>${image ? `<img src="${image}" alt="Generated image">` : `<span class="pending">${escapeHtml(item.status.toUpperCase())}</span>`}</button><div class="archive-card-body"><div class="archive-card-head"><span class="model-tag">${escapeHtml(item.model === 'illustrious' ? 'SDXL · ILLUSTRIOUS' : 'FLUX')}</span><time>${dateFor(item)}</time></div><p class="archive-prompt">${escapeHtml(item.prompt)}</p><p class="archive-negative"><b>Negative</b> ${escapeHtml(item.negative || 'None')}</p><div class="params">${params}</div><button class="ghost reuse-button" data-reuse="${item.id}">Reuse parameters</button></div></article>`;
  }).join('') : '<div class="archive-empty">No generations match these filters.</div>';
  document.querySelectorAll('.archive-image[data-id]').forEach(el => el.onclick = () => openDetail(archive.find(item => item.id == el.dataset.id)));
  document.querySelectorAll('[data-reuse]').forEach(el => el.onclick = () => { reuse(Number(el.dataset.reuse)); showStudio(); });
}

function openDetail(item) {
  if (!item) return;
  const images = imagesFor(item).map(image => `<img src="${image}" alt="Generated image">`).join('');
  const params = Object.entries(item.params || {}).filter(([key]) => !['prompt', 'negative', 'model'].includes(key)).map(([key, value]) => `<span><b>${escapeHtml(key)}</b>${escapeHtml(value)}</span>`).join('');
  $('detailContent').innerHTML = `<p class="kicker">${escapeHtml(item.model.toUpperCase())} · ${dateFor(item)} · ${escapeHtml(item.status.toUpperCase())}</p><div class="detail-images">${images || `<p class="pending">No image saved</p>`}</div><div class="detail-copy"><p><strong>Prompt</strong><br>${escapeHtml(item.prompt)}</p><p><strong>Negative prompt</strong><br>${escapeHtml(item.negative || 'None')}</p><div class="params">${params}</div><button class="ghost" data-detail-reuse="${item.id}">Reuse settings</button></div>`;
  $('detailContent').querySelector('[data-detail-reuse]').onclick = () => { reuse(item.id); closeDetail(); showStudio(); };
  $('detail').showModal();
}
function closeDetail() { $('detail').close(); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])); }
window.reuse = id => { const item = [...history, ...archive].find(entry => entry.id === id); if (!item) return; $('model').value = item.model; fillSettings(); for (const key of ['prompt', 'negative', 'steps', 'cfg', 'seed', 'denoise', 'width', 'height', 'batch', 'shift', 'sampler', 'scheduler']) if (item.params?.[key] !== undefined) setValue(key, item.params[key]); window.scrollTo({ top: 0, behavior: 'smooth' }); };

async function loadStrip() { const result = await api('/api/history?limit=8&offset=0'); history = result.items; stripPage = result; renderStrip(); }
async function loadArchive() {
  const requestToken = ++archiveRequestToken;
  const params = new URLSearchParams({ limit: archivePage.limit, offset: archivePage.offset, model: $('historyModel').value, status: $('historyStatus').value, search: $('historySearch').value, sort: $('historySort').value });
  const result = await api(`/api/history?${params}`);
  if (requestToken !== archiveRequestToken) return;
  archive = result.items; archivePage = result; renderArchive();
}
function renderArchiveError(error) { $('archiveGrid').innerHTML = `<div class="archive-empty">${escapeHtml(error.message)}</div>`; }
function showHistory() { $('historyView').hidden = false; document.querySelector('.hero').hidden = true; document.querySelector('.layout').hidden = true; loadArchive().catch(renderArchiveError); window.scrollTo(0, 0); }
function showStudio() { $('historyView').hidden = true; document.querySelector('.hero').hidden = false; document.querySelector('.layout').hidden = false; window.scrollTo(0, 0); }
function setStatus(available, text) { const status = $('statusDot').parentElement; status.classList.toggle('ok', available); status.classList.toggle('unavailable', !available); $('statusText').textContent = text; }

async function load() {
  try { config = await api('/api/config'); setStatus(config.comfyui, config.comfyui ? 'ComfyUI ready' : 'ComfyUI offline'); fillSettings(); await loadStrip(); }
  catch (error) { setStatus(false, 'Service unavailable'); $('message').textContent = error.message; }
}
$('model').onchange = fillSettings;
$('applyPrompt').onclick = () => { const value = promptSets[$('promptPreset').value]; if (value) $('prompt').value = value; };
$('applyNegative').onclick = () => { const value = negativeSets[$('negativePreset').value]; if (value) $('negative').value = value; };
$('openHistory').onclick = showHistory; $('backToStudio').onclick = showStudio;
$('historyModel').onchange = () => { archivePage.offset = 0; loadArchive().catch(renderArchiveError); }; $('historyStatus').onchange = () => { archivePage.offset = 0; loadArchive().catch(renderArchiveError); }; $('historySort').onchange = () => { archivePage.offset = 0; loadArchive().catch(renderArchiveError); };
let searchTimer; $('historySearch').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { archivePage.offset = 0; loadArchive().catch(renderArchiveError); }, 250); };
$('archivePrevious').onclick = () => { archivePage.offset = Math.max(0, archivePage.offset - archivePage.limit); loadArchive().catch(renderArchiveError); };
$('archiveNext').onclick = () => { if (archivePage.hasNext) { archivePage.offset += archivePage.limit; loadArchive().catch(renderArchiveError); } };
$('closeDetail').onclick = closeDetail; $('detail').addEventListener('click', event => { const detail = $('detail'), rect = detail.getBoundingClientRect(); if (event.target === detail && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeDetail(); });
$('generate').onclick = async () => { const button = $('generate'); button.disabled = true; $('message').textContent = 'Queueing on local GPU…'; const body = { model: $('model').value, prompt: $('prompt').value, negative: $('negative').value, steps: $('steps').value, cfg: $('cfg').value, seed: $('seed').value, denoise: $('denoise').value, sampler: $('sampler').value, scheduler: $('scheduler').value, width: $('width').value, height: $('height').value, batch: $('batch').value, shift: $('shift').value }; try { const result = await api('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); await loadStrip(); $('message').textContent = `Saved · seed ${result.seed}`; } catch (error) { $('message').textContent = error.message; } finally { button.disabled = false; } };
window.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') $('generate').click(); });
load();
