import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react-swc';

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
    permissions: ['activeTab', 'scripting', 'debugger', 'storage'],
    host_permissions: ['<all_urls>'],
    icons: { 128: 'icon.svg' },
    action: { default_icon: 'icon.svg' },
  },
});
