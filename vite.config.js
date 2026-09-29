import {execFileSync} from 'node:child_process';
import { defineConfig, loadEnv } from "vite";
import {assertApiBase} from "./shared/environment-isolation.js";
import react from "@vitejs/plugin-react";

const buildRevision=process.env.VERCEL_GIT_COMMIT_SHA||process.env.RAILWAY_GIT_COMMIT_SHA||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
export default defineConfig(({mode}) => {
  const config = {...loadEnv(mode, process.cwd()), ...process.env};
  assertApiBase(config.VITE_APP_ENV, config.VITE_API_URL);
  return {
  base: "/customer-documents/",
  define:{__BUILD_REVISION__:JSON.stringify(buildRevision)},
  plugins: [react(),{name:'build-evidence',generateBundle(){this.emitFile({type:'asset',fileName:'build-info.json',source:JSON.stringify({revision:buildRevision,builtAt:new Date().toISOString()})});}}],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
          icons: ["lucide-react"]
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000"
    }
  }
};
});
