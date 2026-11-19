import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { createBuildInfo } from './scripts/buildInfo.ts'
// Razboy's GPU solver (src/solvers/razboy) is written with TypeGPU, whose 'use gpu' functions this plugin compiles to WGSL
import typegpu from 'unplugin-typegpu/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [typegpu(), react()],
  base: './',
  define: {
    __BUILD_INFO__: JSON.stringify(createBuildInfo(fileURLToPath(new URL('.', import.meta.url)))),
  },
})
