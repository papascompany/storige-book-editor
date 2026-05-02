import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { EditorErrorBoundary } from './components/EditorErrorBoundary'
import './index.css'
import { initSentry, Sentry } from './lib/sentry'

// Sentry 초기화 (다른 코드보다 먼저)
initSentry()

// 전역 unhandled promise rejection 핸들러 — fabric.js loadImage 등의 비동기 throw가
// React 트리 freeze를 유발하는 것을 방지 (사용자 보고: SVG 업로드 후 어떤 메뉴도
// 클릭/터치 안 됨). 콘솔 로그만 남기고 event.preventDefault로 브라우저의 기본
// "Uncaught (in promise)" 처리를 막아 UI thread 회복.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[unhandledrejection] caught:', event.reason)
    // Sentry로 전송 (DSN 설정된 경우만)
    Sentry.captureException(event.reason)
    event.preventDefault()
  })
}

// Production에서는 /storige-editor 경로에서 배포됨
const basename = import.meta.env.VITE_ROUTER_BASE || ''

// lucide-react는 IconContext.Provider 미지원 — 각 아이콘이 자체 props로 size/strokeWidth 지정
// 기본 lucide 아이콘 size=24 (phosphor와 동일)
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <EditorErrorBoundary>
      <BrowserRouter basename={basename}>
        <App />
      </BrowserRouter>
    </EditorErrorBoundary>
  </React.StrictMode>,
)
