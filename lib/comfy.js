import { randomUUID } from 'node:crypto';
const base = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
class ComfyUIExecutionError extends Error { constructor() { super('ComfyUI execution failed'); this.name = 'ComfyUIExecutionError'; } }
async function jsonFetch(url, options) { const response = await fetch(url, options); const text = await response.text(); let body; try { body = JSON.parse(text); } catch { body = text; } if (!response.ok) throw new Error(`ComfyUI ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`); return body; }
export async function submitAndCollect(graph) {
  const clientId = randomUUID();
  const submitted = await jsonFetch(`${base}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: clientId }) });
  const promptId = submitted.prompt_id; if (!promptId) throw new Error('ComfyUI did not return a prompt id');
  const deadline = Date.now() + Number(process.env.COMFYUI_TIMEOUT_MS || 1800000);
  while (Date.now() < deadline) {
    let images;
    try {
      const history = await jsonFetch(`${base}/history/${encodeURIComponent(promptId)}`);
      const entry = history[promptId];
      if (entry) {
        if (entry.status?.status_str === 'error' || entry.status?.completed === false && entry.status?.messages?.some(m => String(m).includes('error'))) throw new ComfyUIExecutionError();
        images = Object.values(entry.outputs ?? {}).flatMap(output => output.images ?? []);
      }
    } catch (error) {
      // ComfyUI can briefly reject or drop a history request while the job is queued.
      // Keep polling until the same overall deadline rather than losing the job.
      if (error instanceof ComfyUIExecutionError) throw error;
    }
    if (images?.length) return { promptId, images: await Promise.all(images.map(downloadImage)) };
    await pause(1000);
  }
  throw new Error('Timed out waiting for ComfyUI');
}
async function downloadImage(image) { const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' }); const response = await fetch(`${base}/view?${query}`); if (!response.ok) throw new Error(`Could not fetch output image (${response.status})`); return { bytes: Buffer.from(await response.arrayBuffer()), filename: image.filename }; }
export async function checkHealth() { try { const response = await fetch(`${base}/system_stats`); return response.ok; } catch { return false; } }
