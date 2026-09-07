/**
 * Loader hook agar skrip Node bisa mengimpor sumber TypeScript aplikasi apa
 * adanya.
 *
 * Next.js memakai bundler, jadi import di `src/` ditulis tanpa ekstensi
 * (`./supabase/admin`) dan dengan alias `@/`. Node murni tidak mengenal
 * keduanya. Hook ini menambal resolusi itu untuk keperluan skrip saja —
 * kode produksi sengaja tidak diubah supaya tetap idiomatis untuk Next.js.
 *
 * Pakai: node --import ./scripts/ts-resolve.mjs skrip.mjs
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      import { existsSync } from 'node:fs';
      import { fileURLToPath, pathToFileURL } from 'node:url';
      import path from 'node:path';

      const SRC = ${JSON.stringify(pathToFileURL(process.cwd() + '/src/').href)};

      export async function resolve(specifier, context, next) {
        // Alias "@/..." -> src/...
        if (specifier.startsWith('@/')) {
          specifier = new URL(specifier.slice(2), SRC).href;
        }

        // Import relatif/absolut tanpa ekstensi -> coba .ts lalu .tsx
        if (/^(\\.|file:|\\/)/.test(specifier) && !/\\.[a-z]+$/i.test(specifier)) {
          const base = specifier.startsWith('file:')
            ? specifier
            : new URL(specifier, context.parentURL).href;
          for (const ext of ['.ts', '.tsx', '/index.ts']) {
            if (existsSync(fileURLToPath(base + ext))) {
              return next(base + ext, context);
            }
          }
        }

        return next(specifier, context);
      }
    `),
  pathToFileURL('./'),
);
