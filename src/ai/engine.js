// Moteur d'inférence local : LiteRT-LM (Google) sur WebGPU.
// La bibliothèque (≈ quelques Mo de JS + WASM depuis le CDN jsDelivr) n'est chargée qu'au premier usage.
import { errText } from "./capabilities.js";
import { getSource } from "./modelStore.js";

let engine = null, loadingFor = null, loadingPromise = null;
let queue = Promise.resolve(); // une seule génération à la fois

// ------------------------------------------------------------ plantages
// Si le téléphone manque de mémoire, il tue la page sans erreur JavaScript (iPhone surtout) : on note l'étape en
// cours avant de la lancer et on l'efface après ; si la note est encore là au démarrage suivant, la page a planté.
const BUSY = "mtg-ai-busy", LAST_ERR = "mtg-ai-lasterr";
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sans stockage */ } },
};
let crashed = store.get(BUSY); // étape en cours au moment du plantage précédent (« load » ou « gen »), lue une fois
store.set(BUSY, null);
let current = null; // étape en cours dans cette page

// Quitter ou fermer l'appli pendant le chargement n'est pas un plantage : la marque n'est gardée que page visible
// (un téléphone à court de mémoire tue la page pendant qu'on la regarde).
globalThis.document?.addEventListener("visibilitychange", () => store.set(BUSY, document.hidden ? null : current));
globalThis.addEventListener?.("pagehide", () => store.set(BUSY, null));

/** Étape pendant laquelle la page a planté la dernière fois (« load » / « gen »), ou null (aussi après un chargement réussi). */
export const crashedDuring = () => crashed;
/** Dernière erreur du moteur (gardée pour le diagnostic). */
export const lastError = () => store.get(LAST_ERR);
/** Garde une erreur pour le diagnostic (« download », « load », « gen »…). */
export const noteError = (step, e) => store.set(LAST_ERR, `${new Date().toISOString().slice(0, 16)} ${step} : ${errText(e)}`);

/** Exécute `fn` en notant l'étape (détection des plantages) et en gardant l'erreur éventuelle. */
async function tracked(step, fn) {
  const mark = s => { current = s; store.set(BUSY, globalThis.document?.hidden ? null : s); };
  mark(step);
  try { return await fn(); }
  catch (e) { noteError(step, e); throw e; }
  finally { mark(null); }
}

/** Charge le moteur pour ce modèle (déjà téléchargé). Réutilise l'instance existante. */
export async function ensureEngine(model, { onStatus = () => {} } = {}) {
  if (engine && loadingFor === model.id) return engine;
  if (loadingPromise && loadingFor === model.id) return loadingPromise;
  await unload();
  loadingFor = model.id;
  loadingPromise = tracked("load", async () => {
    onStatus("lib");
    const { Engine } = await import("@litert-lm/core");
    onStatus("model");
    const source = await getSource(model);
    engine = await Engine.create({ model: source, mainExecutorSettings: { maxNumTokens: model.maxNumTokens } });
    crashed = null; // le modèle tient en mémoire : l'ancien plantage n'est plus d'actualité
    onStatus("ready");
    return engine;
  });
  try { return await loadingPromise; }
  catch (e) { engine = null; loadingFor = null; throw e?.message ? e : new Error(errText(e)); }
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

export function generate(model, messages, { onToken = () => {}, signal, maxOutputTokens = 900, temperature = 0.6, shouldStop = () => false, vision = false } = {}) {
  const run = async () => {
    const eng = await ensureEngine(model);
    return tracked("gen", async () => {
      const history = messages.slice(0, -1), last = messages[messages.length - 1];
      const conversation = await eng.createConversation({
        preface: { messages: history },
        sessionConfig: { maxOutputTokens, samplerParams: { type: TOP_P, p: 0.92, k: 40, temperature }, ...(vision ? { visionModalityEnabled: true } : {}) },
      });
      let text = "";
      try {
        for await (const chunk of conversation.sendMessageStreaming(Array.isArray(last.content) ? { role: "user", content: last.content } : last.content)) {
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
    });
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}
