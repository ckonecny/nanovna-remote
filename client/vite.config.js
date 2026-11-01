import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execSync } from 'child_process'
import { VitePWA } from 'vite-plugin-pwa'

let commitHash = 'local'
try { commitHash = execSync('git rev-parse --short HEAD', { stdio: 'pipe' }).toString().trim() } catch (e) { /* not a git checkout */ }

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'NanoVNA Remote',
        short_name: 'NanoVNA Remote',
        description: 'Remote control and measurement for a NanoVNA over WiFi',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}']
      }
    })
  ],
  define: {
    __APP_VERSION__: JSON.stringify("v2026-" + commitHash),
  },
  test: {
    environment: 'jsdom',
    globals: true
  },
  server: {
    allowedHosts: ['.trycloudflare.com']
  }
})
