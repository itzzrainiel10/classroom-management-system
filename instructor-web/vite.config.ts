import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Instructor website. Runs at the same time as admin-web (port 5173) on its own port.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
});
