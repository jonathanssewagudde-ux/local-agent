import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 4316,
    strictPort: true,
    host: "localhost",
    proxy: {
      "/api": { target: "http://127.0.0.1:4317", changeOrigin: false },
      "/pty": { target: "ws://127.0.0.1:4317", ws: true },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        picker: resolve(import.meta.dirname, "picker.html"),
      },
    },
  },
});
