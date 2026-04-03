import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';

export default defineConfig({
  srcDir: 'src',
  publicDir: '../public',
  vite: () => ({
    plugins: [react()],
  }),
  manifest: {
    name: 'Opticlick Engine',
    version: '1.0.0',
    description:
      'Autonomous web agent using Set-of-Mark visual prompting and Gemini 3.1 Pro.',
    permissions: ['activeTab', 'scripting', 'debugger', 'storage', 'sidePanel', 'downloads'],
    host_permissions: ['<all_urls>'],
    icons: { 16: 'icon-16.png', 32: 'icon-32.png', 48: 'icon-48.png', 128: 'icon-128.png' },
    action: { default_icon: { 16: 'icon-16.png', 32: 'icon-32.png', 48: 'icon-48.png', 128: 'icon-128.png' } },
    side_panel: { default_path: 'sidepanel.html' },
  },
});
