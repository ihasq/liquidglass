import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'
import glsl from 'vite-plugin-glsl'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react({
      // React for main site pages only
      include: ['src/**/*.tsx', 'src/**/*.ts'],
      exclude: ['**/labs/**'],
    }),
    preact({
      // Preact for labs only
      include: ['labs/**/*.tsx', 'labs/**/*.ts'],
    }),
    tailwindcss(),
    glsl({
      include: ['**/*.glsl', '**/*.vert', '**/*.frag', '**/*.wgsl'],
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        labs: resolve(__dirname, 'labs/index.html'),
      },
    },
  },
})
