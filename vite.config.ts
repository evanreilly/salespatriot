import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "fast-grid": path.resolve(import.meta.dirname, "node_modules/fast-grid/index.ts"),
    },
  },
  optimizeDeps: {
    exclude: ["fast-grid"],
  },
  server: {
    port: 5173,
    allowedHosts: [".trycloudflare.com"],
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
