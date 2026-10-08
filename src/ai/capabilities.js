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
      gpu: [info.vendor, info.architecture, info.description].filter(Boolean).join(" ") || null,
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
