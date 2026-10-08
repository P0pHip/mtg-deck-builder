// Moteur d'inférence local : LiteRT-LM (Google) sur WebGPU.
// La bibliothèque (≈ quelques Mo de JS + WASM depuis le CDN jsDelivr) n'est chargée qu'au premier usage.
import { getBlob } from "./modelStore.js";

let engine = null, loadingFor = null, loadingPromise = null;
let queue = Promise.resolve(); // une seule génération à la fois

/** Charge le moteur pour ce modèle (déjà téléchargé). Réutilise l'instance existante. */
export async function ensureEngine(model, { onStatus = () => {} } = {}) {
  if (engine && loadingFor === model.id) return engine;
  if (loadingPromise && loadingFor === model.id) return loadingPromise;
  await unload();
  loadingFor = model.id;
  loadingPromise = (async () => {
    onStatus("lib");
    const { Engine } = await import("@litert-lm/core");
    onStatus("model");
    const blob = await getBlob(model);
    engine = await Engine.create({ model: blob, mainExecutorSettings: { maxNumTokens: model.maxNumTokens } });
    onStatus("ready");
    return engine;
  })();
  try { return await loadingPromise; }
  catch (e) { engine = null; loadingFor = null; throw e; }
  finally { loadingPromise = null; }
}

export const isLoaded = id => !!engine && loadingFor === id;

export async function unload() {
  if (engine) { try { await engine.delete(); } catch { /* déjà libéré */ } }
  engine = null; loadingFor = null;
}

/**
 * Génère une réponse. `messages` = [{role:"system"|"user"|"assistant", content}], le dernier est l'utilisateur.
 * `onToken(texteCumulé)` est appelé au fil de la génération. `signal` permet d'arrêter.
 */
// Échantillonnage « top-p » : moins de boucles que le choix systématique du token le plus probable.
const TOP_P = 2; // SamplerType.TOP_P de LiteRT-LM

export function generate(model, messages, { onToken = () => {}, signal, maxOutputTokens = 900, temperature = 0.6, shouldStop = () => false } = {}) {
  const run = async () => {
    const eng = await ensureEngine(model);
    const history = messages.slice(0, -1), last = messages[messages.length - 1];
    const conversation = await eng.createConversation({
      preface: { messages: history },
      sessionConfig: { maxOutputTokens, samplerParams: { type: TOP_P, p: 0.92, k: 40, temperature } },
    });
    let text = "";
    try {
      for await (const chunk of conversation.sendMessageStreaming(last.content)) {
        if (signal?.aborted) break; // sortir de la boucle annule la génération
        if (typeof chunk.content === "string") text += chunk.content;
        else for (const part of chunk.content || []) if (part.type === "text") text += part.text;
        onToken(text);
        if (shouldStop(text)) break; // le modèle part en boucle : on coupe
      }
    } finally {
      try { await conversation.delete(); } catch { /* ignore */ }
    }
    return text;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}
