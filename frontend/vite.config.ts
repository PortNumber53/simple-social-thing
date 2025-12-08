import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const enableCloudflarePlugin = env.VITE_DISABLE_CF_PLUGIN !== '1';
  const plugins = [react()];
  if (enableCloudflarePlugin) plugins.push(cloudflare());
  const forwardProxyHeaders = (proxy: any) => {
    const apply = (proxyReq: any, req: any) => {
      const host = req?.headers?.host;
      const xfProto = req?.headers?.['x-forwarded-proto'];
      if (host) proxyReq.setHeader('X-Forwarded-Host', host);
      if (xfProto) {
        proxyReq.setHeader('X-Forwarded-Proto', String(xfProto).split(',')[0].trim());
      } else if (typeof host === 'string' && host.toLowerCase().endsWith('.dev.portnumber53.com')) {
        // nginx sometimes forgets to set X-Forwarded-Proto for the upstream (Vite) request.
        // If it does, the worker will think the public origin is http://..., breaking session persistence
        // across http vs https origins. Default to https for our dev hostnames.
        proxyReq.setHeader('X-Forwarded-Proto', 'https');
      }
    };
    proxy.on('proxyReq', apply);
    // WebSocket proxy requests use a different event.
    proxy.on('proxyReqWs', apply);
  };
  return {
    plugins,
    server: {
      // Listen on all interfaces so LAN / reverse proxies (nginx) can reach dev server.
      // Equivalent to `vite --host 0.0.0.0`.
      host: true,
      hmr: {
        // Keep HMR websocket on the same port the client is served from to reduce proxy/socket churn (EPIPE).
        clientPort: 18910,
      },
      // Allow accessing Vite through nginx with custom dev hostnames.
      // Vite blocks unknown Host headers by default to prevent DNS rebinding attacks.
      allowedHosts: ['simple.dev.portnumber53.com', '.dev.portnumber53.com'],
      port: 18910,
      strictPort: true,
      proxy: {
        '/api': {
          // Use localhost so cookies from the worker apply to the same host the app loads on.
          target: 'http://localhost:18912',
          changeOrigin: true,
          ws: true,
          configure: forwardProxyHeaders,
        },
        // Media (uploaded assets) are served by the worker in dev and proxied to backend.
        // Our API responses include `/media/...` URLs, so proxy them too.
        '/media': {
          target: 'http://localhost:18912',
          changeOrigin: true,
          configure: forwardProxyHeaders,
        },
      },
    },
    preview: {
      // `vite preview` should also be reachable from LAN / reverse proxies.
      host: true,
      port: 18910,
      strictPort: true,
    },
  };
});