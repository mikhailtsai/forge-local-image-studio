import { readFile } from 'node:fs/promises';
import { randomInt } from 'node:crypto';

const ROOT = new URL('../', import.meta.url);
const MAX_SAFE_SEED = Number.MAX_SAFE_INTEGER;
// crypto.randomInt has a 2^48 range limit in Node. Combining two secure
// draws still covers the full JavaScript-safe integer range.
const randomSafeSeed = () => randomInt(0, 2 ** 26) * 2 ** 27 + randomInt(0, 2 ** 27);
const samplers = ['euler','euler_cfg_pp','euler_ancestral','euler_ancestral_cfg_pp','heun','heunpp2','exp_heun_2_x0','exp_heun_2_x0_sde','dpm_2','dpm_2_ancestral','lms','dpm_fast','dpm_adaptive','dpmpp_2s_ancestral','dpmpp_2s_ancestral_cfg_pp','dpmpp_sde','dpmpp_sde_gpu','dpmpp_2m','dpmpp_2m_cfg_pp','dpmpp_2m_sde','dpmpp_2m_sde_gpu','dpmpp_2m_sde_heun','dpmpp_2m_sde_heun_gpu','dpmpp_3m_sde','dpmpp_3m_sde_gpu','ddpm','lcm','ipndm','ipndm_v','deis','res_multistep','res_multistep_cfg_pp','res_multistep_ancestral','res_multistep_ancestral_cfg_pp','gradient_estimation','gradient_estimation_cfg_pp','er_sde','seeds_2','seeds_3','sa_solver','sa_solver_pece','ddim','uni_pc','uni_pc_bh2'];
const schedulers = ['simple','sgm_uniform','karras','exponential','ddim_uniform','beta','normal','linear_quadratic','kl_optimal'];

function uiToApi(workflow) {
  const links = new Map((workflow.links ?? []).map(link => [link[0], [String(link[1]), link[2]]]));
  return Object.fromEntries(workflow.nodes.map(node => {
    const inputs = {};
    for (const input of node.inputs ?? []) {
      if (input.link != null) inputs[input.name] = links.get(input.link);
      else if (node.widgets_values_named && input.name in node.widgets_values_named) inputs[input.name] = node.widgets_values_named[input.name];
    }
    return [String(node.id), { class_type: node.type, inputs }];
  }));
}

const cache = new Map();
async function load(name) {
  if (!cache.has(name)) {
    const file = name === 'flux' ? 'workflows/ai-flux.json' : 'workflows/sdxl-illustrious.json';
    const source = JSON.parse(await readFile(new URL(file, ROOT), 'utf8'));
    cache.set(name, uiToApi(source));
  }
  return structuredClone(cache.get(name));
}

const defaults = {
  flux: { prompt: '', negative: '', seed: null, steps: 4, cfg: 1, sampler: 'res_multistep', scheduler: 'simple', denoise: 1, width: 1024, height: 1024, batch: 1, shift: 3 },
  illustrious: { prompt: '', negative: '', seed: null, steps: 28, cfg: 5, sampler: 'dpmpp_2m_sde', scheduler: 'karras', denoise: 1, width: 1024, height: 1024, batch: 1 }
};

export const workflowConfig = { defaults, samplers, schedulers };
export async function buildGraph(model, raw = {}) {
  if (!defaults[model]) throw new Error('Unknown workflow');
  const p = { ...defaults[model], ...raw };
  p.seed = p.seed == null || p.seed === '' ? randomSafeSeed() : Number(p.seed);
  p.prompt = String(p.prompt ?? '');
  if (!p.prompt.trim()) throw new Error('Positive prompt is required');
  p.steps = Number(p.steps); p.cfg = Number(p.cfg); p.denoise = Number(p.denoise);
  p.width = Number(p.width); p.height = Number(p.height); p.batch = Number(p.batch);
  p.shift = p.shift == null ? 3 : Number(p.shift);
  if (!Number.isSafeInteger(p.seed) || p.seed < 0 || p.seed > MAX_SAFE_SEED) throw new Error('Seed must be between 0 and 9007199254740991');
  if (!Number.isInteger(p.steps) || p.steps < 1 || p.steps > 10000) throw new Error('Steps must be between 1 and 10000');
  if (!Number.isFinite(p.cfg) || p.cfg < 0 || p.cfg > 100) throw new Error('CFG must be between 0 and 100');
  if (!Number.isFinite(p.denoise) || p.denoise < 0 || p.denoise > 1) throw new Error('Denoise must be between 0 and 1');
  const sizeStep = model === 'flux' ? 16 : 8;
  for (const [key, value] of [['width', p.width], ['height', p.height]]) if (!Number.isInteger(value) || value < 16 || value > 16384 || value % sizeStep) throw new Error(`${key} must be a multiple of ${sizeStep}, from 16 to 16384`);
  if (!Number.isInteger(p.batch) || p.batch < 1 || p.batch > 4096) throw new Error('Batch must be between 1 and 4096');
  if (!samplers.includes(p.sampler) || !schedulers.includes(p.scheduler)) throw new Error('Invalid sampler or scheduler');
  if (model === 'flux' && (!Number.isFinite(p.shift) || p.shift < 0 || p.shift > 100)) throw new Error('Shift must be between 0 and 100');
  const graph = await load(model);
  const ids = model === 'flux' ? { text: '67', negative: '71', latent: '68', sampler: '70', output: '9', aura: '69' } : { text: '2', negative: '3', latent: '4', sampler: '5', output: '7' };
  graph[ids.text].inputs.text = p.prompt; graph[ids.negative].inputs.text = String(p.negative ?? '');
  Object.assign(graph[ids.latent].inputs, { width: p.width, height: p.height, batch_size: p.batch });
  Object.assign(graph[ids.sampler].inputs, { seed: p.seed, steps: p.steps, cfg: p.cfg, sampler_name: p.sampler, scheduler: p.scheduler, denoise: p.denoise });
  graph[ids.output].inputs.filename_prefix = `${model}-${Date.now()}`;
  if (model === 'flux') graph[ids.aura].inputs.shift = p.shift;
  return { graph, params: p };
}
