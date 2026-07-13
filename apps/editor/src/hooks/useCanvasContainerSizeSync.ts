import { useEffect, type RefObject } from 'react'
import { useAppStore } from '@/stores/useAppStore'

/**
 * 캔버스 컨테이너 크기 변화 감지 → 모든 캔버스 dim 동기화 + 워크스페이스 재정렬.
 *
 * T6 (2026-07-13): EditorView 의 ResizeObserver 블록을 로직 무변경으로 추출 —
 * '/'(EditorView) 에만 있던 재센터링이 /template(TemplateEditorView)·/embed(EmbeddedEditor)
 * 에 없어서, 객체 선택 시 FeatureSidebar↔ControlBar 스왑으로 캔버스 컨테이너 폭이 바뀌면
 * 페이지가 한쪽으로 밀린 채 방치되는 문제의 공통 해법. 세 뷰가 같은 훅을 배선한다.
 *
 * ⚠️ iOS Safari 크래시 방어 3중 가드(원본 주석 유지) — RAF 병합·1px 지터 무시·동일치수 스킵.
 * setDimensions 가 캔버스 DOM 크기를 바꾸면 ResizeObserver 가 다시 발화 → 동일 호출이
 * 무한 반복되어 iOS Safari 가 페이지를 크래시시킨다. 절대 완화 금지.
 */
export function useCanvasContainerSizeSync(
  ready: boolean,
  containerRef: RefObject<HTMLDivElement>
): void {
  // 컨테이너 크기 변화 감지 → 모든 캔버스 dim 동기화 (마운트 시점 좁은 컨테이너로 캔버스가 치우치는 문제 해결)
  useEffect(() => {
    if (!ready || !containerRef.current) return
    const el = containerRef.current
    // ResizeObserver 무한 루프 방지용 — 마지막 적용 크기 기억해서 변동 없으면 스킵.
    // setDimensions 가 캔버스 DOM 크기를 바꾸면 ResizeObserver 가 다시 발화 → 동일 호출이
    // 무한 반복되어 iOS Safari 가 페이지를 크래시시킴.
    let lastW = 0
    let lastH = 0
    let rafId: number | null = null

    const apply = () => {
      rafId = null
      const w = el.clientWidth
      const h = el.clientHeight
      if (w <= 0 || h <= 0) return
      // 1px 미만 변동은 무시 — 모바일 viewport 지터 흡수
      if (Math.abs(w - lastW) < 1 && Math.abs(h - lastH) < 1) return
      // 첫 동기화는 WorkspacePlugin.reset() 의 setZoomAuto 가 이미 처리.
      // 이후 호출(사이드바 토글/창 리사이즈/ControlBar 표시 등)에서만 워크스페이스 재정렬.
      const isFirstApply = lastW === 0 && lastH === 0
      lastW = w
      lastH = h

      const { allCanvas: canvases, allEditors: editors } = useAppStore.getState()
      canvases.forEach((cvs, i) => {
        try {
          if (!cvs || (cvs as any).disposed) return
          // 현재 fabric 캔버스 크기와 같으면 스킵 (불필요한 setDimensions 방지)
          if (cvs.getWidth?.() === w && cvs.getHeight?.() === h) return
          cvs.setDimensions({ width: w, height: h })

          // 사이드 메뉴 토글/사이드바 드래그/창 리사이즈로 캔버스 폭이 바뀌면
          // 페이지(workspace)가 한쪽으로 치우쳐 보이는 문제 해결.
          // - 현재 줌에서 페이지가 새 영역에 들어가면: 줌 유지하고 중앙으로만 이동.
          // - 들어가지 않으면: 자동맞춤(setZoomAuto)으로 페이지 전체가 보이게 다시 스케일.
          if (!isFirstApply) {
            const ed = editors[i]
            const ws = ed?.getPlugin?.<any>('WorkspacePlugin')
            const workspace = cvs.getObjects?.().find?.((o: any) => o.id === 'workspace')
            if (ws && workspace) {
              const zoom = cvs.getZoom?.() || 1
              const wsScreenW = (workspace.width || 0) * (workspace.scaleX || 1) * zoom
              const wsScreenH = (workspace.height || 0) * (workspace.scaleY || 1) * zoom
              // 5% 여백을 둬서 경계에서의 미세 진동(자동맞춤 ↔ 중앙이동 반복) 방지.
              const PADDING = 0.95
              const fits = wsScreenW <= w * PADDING && wsScreenH <= h * PADDING
              if (fits) {
                ws.setCenterPointOf?.(workspace)
              } else {
                ws.setZoomAuto?.()
              }
            }
          }

          cvs.requestRenderAll?.()
        } catch (e) {
          console.warn('[useCanvasContainerSizeSync] canvas resize error:', e)
        }
      })
      editors.forEach((ed) => {
        try { ed?.emit?.('sizeChange', { width: w, height: h }) } catch { /* noop */ }
      })
    }

    // RAF 로 합쳐 한 프레임에 한 번만 실행 — ResizeObserver 가 동일 프레임에서 여러 번
    // 발화해도 마지막 값으로 1회만 적용.
    const schedule = () => {
      if (rafId != null) return
      rafId = window.requestAnimationFrame(apply)
    }

    // 초기 1회 동기화
    apply()
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    window.addEventListener('resize', schedule)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', schedule)
      if (rafId != null) window.cancelAnimationFrame(rafId)
    }
  }, [ready, containerRef])
}
