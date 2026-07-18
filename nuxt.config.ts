export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    hostPassword: process.env.HOST_PASSWORD || 'admin123',
    publicUrl: process.env.PUBLIC_URL || '',
    uploadDir: process.env.UPLOAD_DIR || '',
  },

  nitro: {
    // Socket.IO 需要靠 nitro 的 websocket 支援才能升級連線（否則只能退回 polling）
    experimental: { websocket: true },
  },

  app: {
    head: {
      htmlAttrs: { lang: 'zh-Hant' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      ],
      link: [{ rel: 'icon', type: 'image/png', href: '/icon.png' }],
    },
  },
})
