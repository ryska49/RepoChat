import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/ask": "http://localhost:3001",
      "/ingest": "http://localhost:3001",
      "/file": "http://localhost:3001",
      "/repos": "http://localhost:3001",
      "/health": "http://localhost:3001",
    },
  },
});
