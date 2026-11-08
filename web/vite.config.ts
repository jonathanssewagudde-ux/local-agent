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
      "/api": { target: "http://localhost:4317", changeOrigin: false },
      "/pty": { target: "ws://localhost:4317", ws: true },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        picker: resolve(__dirname, "picker.html"),
      },
    },
  },
});
