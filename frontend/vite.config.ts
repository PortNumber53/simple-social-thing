import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const enableCloudflarePlugin = env.VITE_DISABLE_CF_PLUGIN !== '1';
  const plugins = [react()];
  if (enableCloudflarePlugin) plugins.push(cloudflare());
  return {
    plugins,
    server: {
      port: 18910,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://localhost:18912',
          changeOrigin: true,
          ws: true,
        },
        // Media (uploaded assets) are served by the worker in dev and proxied to backend.
        // Our API responses include `/media/...` URLs, so proxy them too.
        '/media': {
          target: 'http://localhost:18912',
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: 18910,
      strictPort: true,
    },
  };
});