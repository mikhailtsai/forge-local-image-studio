import express from 'express';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { buildGraph, workflowConfig } from './lib/workflows.js';
import { checkHealth, submitAndCollect } from './lib/comfy.js';
import { createGeneration, getGeneration, listGenerations, setPromptId, updateGeneration } from './lib/db.js';

const app = express(); const port = Number(process.env.PORT || 3000); const imageDir = path.resolve('data/images');
await mkdir(imageDir, { recursive: true });
app.use(express.json({ limit: '1mb' })); app.use('/images', express.static(imageDir)); app.use(express.static('public'));
app.get('/api/config', async (_req, res) => res.json({ workflows: workflowConfig, comfyui: await checkHealth() }));
app.get('/api/history', (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 12, 1), 100);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  const model = ['flux', 'illustrious'].includes(req.query.model) ? req.query.model : '';
  const status = ['queued', 'complete', 'error'].includes(req.query.status) ? req.query.status : '';
  const search = String(req.query.search || '').trim().slice(0, 200);
  const sort = req.query.sort === 'oldest' ? 'oldest' : 'newest';
  res.json(listGenerations({ limit, offset, model, status, search, sort }));
});
app.get('/api/history/:id', (req, res) => { const item = getGeneration(req.params.id); item ? res.json(item) : res.status(404).json({ error: 'Not found' }); });
app.post('/api/generate', async (req, res) => {
  let built; let id;
  try { const model = req.body.model || 'flux'; built = await buildGraph(model, req.body); id = createGeneration({ model, params: built.params, promptId: null, prompt: built.params.prompt, negative: built.params.negative });
    const result = await submitAndCollect(built.graph); setPromptId(id, result.promptId); updateGeneration(id, 'complete', await saveImages(id, result.images)); res.json(getGeneration(id));
  } catch (error) { if (id) updateGeneration(id, 'error', [], error.message); res.status(400).json({ error: error.message, id }); }
});
async function saveImages(id, images) { return Promise.all(images.map(async (image, index) => { const ext = path.extname(image.filename) || '.png'; const name = `${id}-${index}${ext}`; await writeFile(path.join(imageDir, name), image.bytes); return `/images/${name}`; })); }
app.listen(port, () => console.log(`Image generator listening at http://localhost:${port}`));
