import { mergeConfig } from "vite";
import runtime from "./vite.runtime.config";

export default mergeConfig(runtime, {
  base: "./",
  define: { "import.meta.env.VITE_RYONG_PREVIEW_ONLY": JSON.stringify("1") },
  build: {
    assetsInlineLimit: 10000000,
    cssCodeSplit: false,
    rollupOptions: { input: "./index.html", output: { inlineDynamicImports: true } },
  },
});
