// Builds one self-contained HTML file (no server needed — double-click to open).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { outDir: 'dist-single', emptyOutDir: true },
});
