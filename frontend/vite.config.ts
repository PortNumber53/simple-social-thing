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
  };
});