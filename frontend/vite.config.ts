import { defineConfig } from "vite";
const backend = process.env.BACKEND_ORIGIN ?? 'http://localhost:18080';
export default defineConfig({
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": { target: backend },
      "/ws": { target: backend.replace(/^http/, "ws"), ws: true },
    },
  },
  build: { rollupOptions: { output: { manualChunks: { three: ["three"] } } } },
});
