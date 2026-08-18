import { useEffect, type RefObject } from 'react'
import { syncFabricDevicePixelRatio } from '@storige/canvas-core'
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
    // dpr(레티나 배율) 추적 — 줌/모니터 이동/OS 배율 변경으로 dpr 만 바뀌는 경우 감지용.
    let lastDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    let rafId: number | null = null

    const apply = () => {
      rafId = null
      const w = el.clientWidth
      const h = el.clientHeight
      if (w <= 0 || h <= 0) return
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
      // dpr 변경은 CSS px 크기를 그대로 두므로(clientW/H 불변) 아래 지터 가드·getWidth()===w
      // 가드에 걸려 스킵된다. 명시적으로 감지해 retina 백킹스토어 재정합을 강제한다
      // (미대응 시 getPointer cssScale ≠ retina 배율 → 클릭 좌표가 원점서 멀수록 밀림).
      const dprChanged = Math.abs(dpr - lastDpr) >= 0.01
      // 1px 미만 변동은 무시 — 모바일 viewport 지터 흡수 (단, dpr 변경 시엔 통과)
      if (!dprChanged && Math.abs(w - lastW) < 1 && Math.abs(h - lastH) < 1) return
      // 첫 동기화는 WorkspacePlugin.reset() 의 setZoomAuto 가 이미 처리 — 단, 캔버스가
      // ready 전 레이아웃 변동 중에 생성돼 stale 컨테이너 크기로 동결된 경우(기존 fabric
      // 치수 ≠ 새 w/h)는 첫 apply 에서도 재정렬한다(C-2: 시드분·추가분 뷰포트 기준 통일).
      // 스킵은 '기존 치수 == 새 w/h'인 캔버스에만 적용(캔버스별 판정 — 아래 sizeUnchanged).
      const isFirstApply = lastW === 0 && lastH === 0
      lastW = w
      lastH = h
      lastDpr = dpr

      // dpr 이 바뀌었으면 fabric 의 캐시된 devicePixelRatio 를 먼저 갱신 — 그래야 이어지는
      // setDimensions 의 _initRetinaScaling 이 새 dpr 로 백킹스토어를 재산출한다. (갱신 없이
      // setDimensions 만 재호출하면 stale dpr 로 재산출돼 오프셋이 남는다.)
      if (dprChanged) syncFabricDevicePixelRatio()

      const { allCanvas: canvases, allEditors: editors } = useAppStore.getState()
      canvases.forEach((cvs, i) => {
        try {
          if (!cvs || (cvs as any).disposed) return
          // 현재 fabric 캔버스 크기와 같으면 스킵 (불필요한 setDimensions 방지).
          // ⚠️ 단 dpr 이 바뀌었으면 논리 크기가 같아도 retina 백킹스토어 재적용이 필요하므로 가드 우회.
          // (setDimensions 전에 캡처 — 순수 dpr 변경 판정에 재사용)
          const sizeUnchanged = cvs.getWidth?.() === w && cvs.getHeight?.() === h
          // setZoomAuto 는 wrapper 의 getBoundingClientRect() 소수폭으로 캔버스 크기를 잡아
          // clientWidth 정수(w/h)와 상시 불일치할 수 있다 — 첫 apply '보존' 판정용으로 1px
          // 허용오차 판정을 setDimensions 전에 함께 캡처(no-op 가드·pureDprChange 는 현행 유지).
          const nearlyUnchanged =
            Math.abs((cvs.getWidth?.() ?? 0) - w) < 1 && Math.abs((cvs.getHeight?.() ?? 0) - h) < 1
          if (!dprChanged && sizeUnchanged) return
          cvs.setDimensions({ width: w, height: h })
          // getPointer 오프셋(_offset) 재계산 — setDimensions 내부에서도 호출되지만
          // dpr/레이아웃 변경 후 클릭 좌표 정합을 확실히 하기 위해 명시.
          cvs.calcOffset?.()

          // 사이드 메뉴 토글/사이드바 드래그/창 리사이즈로 캔버스 폭이 바뀌면
          // 페이지(workspace)가 한쪽으로 치우쳐 보이는 문제 해결.
          // - 현재 줌에서 페이지가 새 영역에 들어가면: 줌 유지하고 중앙으로만 이동.
          // - 들어가지 않으면: 자동맞춤(setZoomAuto)으로 페이지 전체가 보이게 다시 스케일.
          // 순수 dpr 변경(캔버스 논리 크기 불변)이면 위 setDimensions+calcOffset 으로 클릭좌표만
          // 정합하고 재센터는 건너뛴다 — 사용자 pan/zoom 보존(모니터 이동·OS 배율 변경 시
          // 뷰포트가 항등행렬/중앙으로 리셋되던 회귀 방지). 크기가 실제로 바뀐 경우는 기존대로 재정렬.
          const pureDprChange = dprChanged && sizeUnchanged
          // 첫 apply 재센터 스킵을 '해당 캔버스의 기존 fabric 치수가 새 w/h 와 동일할 때'로
          // 좁힘 — 치수가 달랐다면 생성 시점 setZoomAuto 기준이 이미 stale 이므로 재정렬 필요.
          // (동일치수 스킵·1px 지터·RAF 병합 3중 가드는 위에서 그대로 유지 — 치수 비교 가드
          //  안쪽의 재센터 조건만 확장이라 무한 루프 특성 불변.)
          const skipFirstApplyRecenter = isFirstApply && nearlyUnchanged
          if (!skipFirstApplyRecenter && !pureDprChange) {
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

    // dpr(레티나 배율) 변경 감지 — 브라우저 줌은 'resize' 로도 잡히지만, 모니터 간 이동/OS
    // 배율 변경은 CSS 레이아웃 크기를 바꾸지 않아 resize/ResizeObserver 가 발화하지 않는다.
    // 현재 dpr 로 `(resolution: Ndppx)` MQL 을 걸고, dpr 이 바뀌면 change 로 apply 를 예약한 뒤
    // 새 dpr 로 재무장한다.
    // 타입명(MediaQueryList) 을 직접 쓰지 않는다 — 이 앱 eslint no-undef 가 DOM lib 타입을
    // 미해석해 오탐하기 때문(ReturnType 으로 우회, 폴백 캐스트는 구조적 타입만 사용).
    let dprMql: ReturnType<typeof window.matchMedia> | null = null
    const disarmDprMql = () => {
      if (!dprMql) return
      try {
        if (dprMql.removeEventListener) dprMql.removeEventListener('change', onDprChange)
        else (dprMql as { removeListener?: (l: () => void) => void }).removeListener?.(onDprChange)
      } catch { /* noop */ }
      dprMql = null
    }
    function onDprChange() {
      schedule()
      armDprMql()
    }
    function armDprMql() {
      if (typeof window === 'undefined' || !window.matchMedia) return
      disarmDprMql()
      try {
        const dpr = window.devicePixelRatio || 1
        dprMql = window.matchMedia(`(resolution: ${dpr}dppx)`)
        if (dprMql.addEventListener) dprMql.addEventListener('change', onDprChange)
        else (dprMql as { addListener?: (l: () => void) => void }).addListener?.(onDprChange)
      } catch { /* noop — matchMedia 미지원/차단 환경 */ }
    }

    // 초기 1회 동기화
    apply()
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    window.addEventListener('resize', schedule)
    armDprMql()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', schedule)
      disarmDprMql()
      if (rafId != null) window.cancelAnimationFrame(rafId)
    }
  }, [ready, containerRef])
}
