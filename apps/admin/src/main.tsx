import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import { initSentry, Sentry } from './lib/sentry'

// Sentry 초기화 (다른 코드보다 먼저)
initSentry()

// Unhandled promise rejection → Sentry
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[admin/unhandledrejection]:', event.reason)
    Sentry.captureException(event.reason)
  })
}

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
