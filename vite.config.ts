import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/', // absolute: /t/<device> and /field/tags must load /assets/...
  server: { port: 5173 },
});
