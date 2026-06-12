import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  define: {
    "process.env": "{}",
  },
  optimizeDeps: {
    exclude: ["kokoro-js", "onnxruntime-web"],
  },
  worker: {
    format: "es",
    plugins: () => [],
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // kitten-tts-js tries `import('onnxruntime-node')` first (Node-only native
      // package). Bundling it produces a broken module namespace at runtime
      // ("undefined is not an object (evaluating p.env)"). Always use the web runtime.
      "onnxruntime-node": "onnxruntime-web",
    },
  },
}));
