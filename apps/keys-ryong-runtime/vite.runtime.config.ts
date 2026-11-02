import { mergeConfig } from "vite";
import { fileURLToPath } from "node:url";
import base from "./vite.config";

export default mergeConfig(base, {
  define: { "import.meta.env.VITE_RYONG_RUNTIME": JSON.stringify("1") },
  resolve: {
    alias: {
      "@zmkfirmware/zmk-studio-ts-client": fileURLToPath(
        new URL("../../vendor/runtime-studio-client/lib", import.meta.url)
      ),
    },
  },
});
