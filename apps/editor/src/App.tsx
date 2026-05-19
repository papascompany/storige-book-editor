import { Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'
import { useThemeSync } from '@/stores/useUiPrefStore'
import { useGuestStore } from '@/stores/useGuestStore'
import ToastViewport from '@/components/editor/ToastViewport'

// Lazy load views
const EditorView = lazy(() => import('./views/EditorView'))
const TemplateEditorView = lazy(() => import('./views/TemplateEditorView'))
const BrowseContentsView = lazy(() => import('./views/BrowseContentsView'))
const UnauthorizedView = lazy(() => import('./views/UnauthorizedView'))

// Loading fallback component
function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-screen bg-editor-bg">
      <div className="text-editor-text">Loading...</div>
    </div>
  )
}

function App() {
  // 테마 (light/dark/system)를 <html data-theme> 속성에 동기화
  useThemeSync()

  // 인쇄 워크플로우 v1 Phase 4 (2026-05-19) — 게스트 세션 복원
  const initializeGuestFromStorage = useGuestStore((s) => s.initializeFromStorage)
  useEffect(() => {
    initializeGuestFromStorage()
  }, [initializeGuestFromStorage])

  return (
    <>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/" element={<EditorView />} />
          <Route path="/template" element={<TemplateEditorView />} />
          <Route path="/browse" element={<BrowseContentsView />} />
          <Route path="/unauthorized" element={<UnauthorizedView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <ToastViewport />
    </>
  )
}

export default App
