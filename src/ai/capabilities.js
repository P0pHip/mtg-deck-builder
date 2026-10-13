// Détection de ce que l'appareil sait faire pour l'IA locale.

/** { webgpu, adapter, reason } — reason explique pourquoi l'IA locale n'est pas possible. */
export async function checkWebGPU() {
  if (!("gpu" in navigator)) return { webgpu: false, reason: "no-webgpu" };
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return { webgpu: false, reason: "no-adapter" };
    const info = adapter.info || {};
    return {
      webgpu: true,
      f16: adapter.features.has("shader-f16"),
      maxBuffer: adapter.limits.maxBufferSize,
      maxBinding: adapter.limits.maxStorageBufferBindingSize,
      // sans doublons : Safari répond « apple » pour le fabricant, l'architecture et la description
      gpu: [...new Set([info.vendor, info.architecture, info.description].filter(Boolean))].join(" ") || null,
    };
  } catch (e) {
    return { webgpu: false, reason: "adapter-error", error: e.message };
  }
}

/** Espace de stockage disponible pour l'appli (octets), si le navigateur le donne. */
export async function storageEstimate() {
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    return { quota, usage, free: quota - usage };
  } catch {
    return null;
  }
}

/** Demande au navigateur de ne pas effacer les données de l'appli en cas de manque de place. */
export async function requestPersistence() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}

export const deviceMemoryGB = () => navigator.deviceMemory || null;

/** iPhone / iPad (les iPad récents se présentent comme un Mac, mais avec un écran tactile). */
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// Petit module WebAssembly qui n'est valide que si le navigateur gère le « relaxed SIMD » (choix de la version du moteur).
const RELAXED_SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1,
  0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11]);

/** Ce que le moteur de l'IA a besoin de savoir sur WebAssembly (pour le diagnostic). */
export async function wasmFeatures() {
  let relaxedSimd = false;
  try { await WebAssembly.instantiate(RELAXED_SIMD); relaxedSimd = true; } catch { /* non géré */ }
  return { relaxedSimd, jspi: "Suspending" in WebAssembly, isolated: !!globalThis.crossOriginIsolated };
}

/** Message lisible pour n'importe quelle erreur (le moteur peut lancer autre chose qu'une Error). */
export function errText(e) {
  if (e?.message) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e) ?? String(e); } catch { return String(e); }
}
