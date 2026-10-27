import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [react(), nodePolyfills()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-core': ['react', 'react-dom', 'react/jsx-runtime'],
          'wagmi-core': ['wagmi', 'viem', '@tanstack/react-query'],
          'connectkit': ['connectkit'],
          'circle-app-kit': ['@circle-fin/app-kit'],
          'circle-bridge-kit': ['@circle-fin/bridge-kit', '@circle-fin/unified-balance-kit'],
          'ui': ['lucide-react', 'sonner', 'clsx', 'tailwind-merge'],
          'framer': ['framer-motion'],
          'qr': ['qrcode.react'],
          'qr-scanner': ['html5-qrcode'],
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@tanstack/react-query',
      'wagmi',
      'wagmi/chains',
      'wagmi/connectors',
      'viem',
      'viem/chains',
      'connectkit',
      'framer-motion',
      'lucide-react',
      'sonner',
      'clsx',
      'tailwind-merge',
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
  },
  server: {
    allowedHosts: true,
    cors: true,
  },
})
