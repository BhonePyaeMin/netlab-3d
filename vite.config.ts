import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// `base` must match the GitHub Pages sub-path when deploying to a project
// site (https://<user>.github.io/<repo>/). The workflow sets VITE_BASE;
// local dev and `vite preview` fall back to the root so nothing changes there.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  build: {
    // three.js + drei make a large single chunk by design; raise the warning
    // threshold rather than pretending it is a problem to fix at build time.
    chunkSizeWarningLimit: 1600,
  },
})
