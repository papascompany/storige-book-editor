import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { EditorErrorBoundary, reloadOnceForStaleChunk } from './components/EditorErrorBoundary'
import './index.css'
import { initSentry, Sentry } from './lib/sentry'
// OpenCV 자산 URL 주입(side-effect) — 모양컷 칼선의 getCv() 가 <script> 태그 로드를 쓰도록.
// ⚠️ embed.tsx 에는 넣지 않는다(스텁 유지 + 10MB 자산 미유입). utils/opencvLoader.ts 주석 참조.
import './utils/opencvLoader'

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

// 배포 후 청크 재해시(stale chunk) 자동 리로드 —
// 새 배포가 나가면 lazy 청크(예: AppEdit-<hash>.js)의 파일명이 바뀐다. 배포 전에 열어둔
// 옛 탭은 옛 파일명을 참조하므로 EDIT 메뉴 등에서 dynamic import 가 404 → 편집기가
// EditorErrorBoundary 로 떨어진다(사용자 보고). vite 는 이 실패를 window 'vite:preloadError'
// 로 알린다 → 1회 새로고침으로 신규 index.html(=신규 청크 해시)을 받아 자동 복구한다.
// 무한 루프 방지: sessionStorage 타임스탬프('__chunkReloadOnce') 쿨다운으로 직후 재실패
// 시에는 리로드하지 않는다(옛 타임스탬프는 자연 만료 → 다음 배포에서 재차 1회 허용).
// 편집 손실 없음: 편집 진입(lazy 로드) 시점에 실패하며, 임베드는 자동저장 + RestoreBackupBanner
// 로 복원을 제안한다.
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    console.error('[vite:preloadError] stale chunk — attempting one-time reload', event)
    // vite 기본 동작(에러 재throw) 억제 — 우리가 리로드로 처리.
    event.preventDefault()
    reloadOnceForStaleChunk()
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
