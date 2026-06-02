import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

const API = process.env.API_URL ?? "http://localhost:3001";

export default defineConfig({
  root: "web",
  plugins: [preact()],
  server: {
    port: Number(process.env.WEB_PORT ?? 3000),
    proxy: {
      "/api": { target: API, changeOrigin: true, ws: false },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
