import { mergeConfig } from "vite";
import { fileURLToPath } from "node:url";
import base from "./vite.config";

export default mergeConfig(base, {
  define: { "import.meta.env.VITE_RYONG_RUNTIME": JSON.stringify("1") },
  // keysbeta also serves the owner's admin page at /admin (its API lives in admin-functions/).
  build: { rollupOptions: { input: { main: "./index.html", download: "./download.html", admin: "./admin/index.html" } } },
  resolve: {
    alias: {
      "@zmkfirmware/zmk-studio-ts-client": fileURLToPath(
        new URL("../../vendor/runtime-studio-client/lib", import.meta.url)
      ),
    },
  },
});
