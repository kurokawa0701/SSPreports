import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pagesなどサブパス配下で公開する場合でもアセットの参照が壊れないよう、相対パスにする
  base: './',
})
