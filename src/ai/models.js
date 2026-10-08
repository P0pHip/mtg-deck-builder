// Modèles IA disponibles en local (LiteRT-LM, WebGPU). Seuls les fichiers « -web » sont compatibles navigateur.
export const MODELS = {
  "gemma-4-e2b": {
    id: "gemma-4-e2b",
    label: "Gemma 4 E2B",
    file: "gemma-4-E2B-it-web.litertlm",
    url: "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm",
    approxBytes: 2.01e9,
    maxNumTokens: 4096,
  },
};
export const DEFAULT_MODEL = "gemma-4-e2b";
