import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import glsl from 'vite-plugin-glsl';
import preact from '@preact/preset-vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// Read package.json for version
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig(({ mode }) => {
  const isDev = mode !== 'production';

  return {
    plugins: [
      preact(),
      glsl({
        minify: !isDev,
        include: [
          '**/*.glsl',
          '**/*.vert',
          '**/*.frag',
          '**/*.wgsl',
        ],
      }),
      dts({ include: ['src'] })
    ],
    define: {
      // Development mode flag - replaced at build time
      // In production: false (enables dead code elimination)
      // In development: true (enables debug logs)
      'globalThis.__LIQUIDGLASS_DEV__': JSON.stringify(isDev),
      // Library version
      'globalThis.__LIQUIDGLASS_VERSION__': JSON.stringify(pkg.version),
    },
    build: {
      lib: {
        entry: {
          liquidglass: resolve(__dirname, 'src/liquidglass.ts'),
          schema: resolve(__dirname, 'src/schema/parameters.ts'),
          env: resolve(__dirname, 'src/env.ts'),
        },
        formats: ['es'],
      },
      rollupOptions: {
        external: [],
        output: {
          globals: {},
          entryFileNames: '[name].js',
        }
      },
      // esbuild handles dead code elimination automatically
      // when __LIQUIDGLASS_DEV__ is replaced with false
      minify: true,
    },
    server: {
      port: 8788
    }
  };
});
