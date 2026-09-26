import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'

/**
 * The board: TanStack Start in SPA mode. The build prerenders one shell, the
 * root route's document with no page in it, into `dist/client/_shell.html`,
 * beside the one script and the one stylesheet it names; the daemon serves
 * that shell at every page's address, and the script draws the page there.
 * `dist/server` is the build the prerender ran, which nothing serves.
 */
export default defineConfig({
  // The prerender starts a preview server from this file alone, so the root
  // and the output are spelled here rather than taken from where the build was
  // started, which would find no router and read a stale server build.
  root: import.meta.dirname,
  build: {
    outDir: `${import.meta.dirname}/dist`,
    emptyOutDir: true,
    sourcemap: true,
    // Geist is inlined into the stylesheet, as the Bun bundle inlined it, so
    // no text is drawn in a fallback face before the font arrives.
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? true : undefined),
    // The board is one script on purpose, so Vite's advice to split a large
    // chunk is not taken, and its warning would only repeat on every build.
    chunkSizeWarningLimit: Number.POSITIVE_INFINITY,
    rolldownOptions: {
      // Base UI and the stock shadcn components mark their modules
      // "use client", which says nothing to a page that renders only in the
      // browser; the bundler drops it and would warn once per module.
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('"use client"')) return
        warn(warning)
      },
    },
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      spa: { enabled: true },
      // One script, as the Bun bundle was: no route chunk that a rebuild
      // could delete from under an open page.
      router: { codeSplittingOptions: { defaultBehavior: [] } },
    }),
  ],
})
