import { defineConfig, type Plugin } from 'vite';
import dts from 'vite-plugin-dts';
import glsl from 'vite-plugin-glsl';
import preact from '@preact/preset-vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { lutInlinePlugin } from './vite-plugin-lut-inline';

// Read package.json for version
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

// Plugin to inline ?raw imports as string literals in production build
function inlineRawPlugin(): Plugin {
  return {
    name: 'inline-raw',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source.endsWith('?raw') && importer) {
        const cleanPath = source.replace('?raw', '');
        const fullPath = resolve(importer, '..', cleanPath);
        return `\0inline-raw:${fullPath}`;
      }
      return null;
    },
    load(id) {
      if (id.startsWith('\0inline-raw:')) {
        const filePath = id.slice('\0inline-raw:'.length);
        const content = readFileSync(filePath, 'utf-8');
        return `export default ${JSON.stringify(content)};`;
      }
      return null;
    },
  };
}

export default defineConfig(({ mode }) => {
  const isDev = mode !== 'production';

  return {
    plugins: [
      inlineRawPlugin(),
      preact(),
      // LUT inline plugin - transforms binary LUTs to inline code at build time
      lutInlinePlugin({
        lutDir: resolve(__dirname, 'build/luts'),
      }),
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
          tailwind: resolve(__dirname, 'src/tailwind.ts'),
          schema: resolve(__dirname, 'src/schema/parameters.ts'),
          env: resolve(__dirname, 'src/env.ts'),
        },
        formats: ['es'],
      },
      rollupOptions: {
        external: ['tailwindcss/plugin'],
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
