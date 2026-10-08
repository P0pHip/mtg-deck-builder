import { defineConfig } from "vite";

export default defineConfig({
  // chemins relatifs : l'appli fonctionne à la racine comme dans un sous-dossier (GitHub Pages)
  base: "./",
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
  test: { environment: "node", include: ["tests/**/*.test.js"], setupFiles: ["tests/setup.js"] },
});
