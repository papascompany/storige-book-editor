import ContextMenu from './contextMenu'

export interface TouchContextMenuOptions {
  /** 롱프레스 발화 임계(ms). 기본 500. */
  pressMs?: number
  /** 이 화면 px 초과로 이동하면 롱프레스 취소(스크롤/드래그 양보). 기본 10. */
  moveTolerancePx?: number
  /** 발화 시 진동 피드백. 기본 true(미지원 브라우저는 무해 no-op). */
  haptic?: boolean
}

/**
 * C6: 캔버스 wrapperEl 에 터치 롱프레스 컨텍스트 메뉴 트리거를 부착한다.
 *
 * - pointer 이벤트 기반(WorkspacePlugin.bindPinch 와 동일 레이어). fabric 의 터치→마우스
 *   매핑과 독립이며, 두 손가락 핀치(WorkspacePlugin)와 같은 wrapperEl 을 공유하되 자체
 *   포인터 카운터로 T-1(두 번째 포인터=핀치 즉시 취소)을 감지한다(_pinchPointers 는 private).
 * - 데스크탑 마우스(pointerType!=='touch')는 전부 무시 → 기존 우클릭 컨텍스트 경로 무회귀.
 * - 발화 시 진행 중 fabric transform 만 중단(_currentTransform=undefined)하고 활성 객체는
 *   유지한다(discardActiveObject 금지 — onlyForActiveObject 메뉴가 살아 있어야 함).
 * - move 는 preventDefault 하지 않고 임계 초과 시 타이머만 취소해 스크롤/핀치에 양보한다.
 *
 * @returns 정리(disposer) 함수 — 리스너 4종 + 대기 타이머를 해제한다. SSR/구형 브라우저에서는
 *          no-op disposer 를 반환한다.
 */
export function attachTouchContextMenu(
  canvas: fabric.Canvas,
  contextMenu: ContextMenu,
  options: TouchContextMenuOptions = {}
): () => void {
  const wrapper = (canvas as unknown as { wrapperEl?: HTMLElement }).wrapperEl
  if (!wrapper || typeof window === 'undefined' || !window.PointerEvent) {
    return () => {}
  }

  const pressMs = options.pressMs ?? 500
  const moveTolerancePx = options.moveTolerancePx ?? 10
  const haptic = options.haptic ?? true

  // 자체 활성 포인터 추적(핀치 감지용 — WorkspacePlugin._pinchPointers 는 접근 불가)
  const activePointers = new Set<number>()
  let pressTimer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0
  // 이번 제스처에서 메뉴가 발화됐는지 — pointerup 에서 T-5 억제창 재-arm 판정
  let firedThisGesture = false

  const clearTimer = () => {
    if (pressTimer !== null) {
      clearTimeout(pressTimer)
      pressTimer = null
    }
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return
    activePointers.add(e.pointerId)
    // 두 번째 포인터(핀치) 도착 → 롱프레스 즉시 취소(핀치에 양보)
    if (activePointers.size !== 1) {
      clearTimer()
      return
    }
    startX = e.clientX
    startY = e.clientY
    firedThisGesture = false
    clearTimer()
    pressTimer = setTimeout(() => {
      pressTimer = null
      // 발화 시점 재확인: 여전히 단일 터치 포인터일 때만
      if (activePointers.size !== 1) return
      // T-4: 진행 중 fabric transform 을 중단하되, 롱프레스 대기 동안 fabric 이 서브임계(<10px)
      // 지터로 밀어놓은 위치를 변환 시작 시점(original)으로 복원한다. 미복원 시 그 이동이
      // object:modified 없이(=undo 불가) 모델에 잔류해 canvasData 에 직렬화된다(적대 리뷰 MAJOR).
      // discardActiveObject 는 제외(활성객체 유지 → onlyForActiveObject 메뉴 보존).
      const cAny = canvas as unknown as {
        _currentTransform?: {
          target?: { set?: (o: { left: number; top: number }) => void; setCoords?: () => void }
          original?: { left?: number; top?: number }
        }
      }
      const tf = cAny._currentTransform
      if (tf) {
        const target = tf.target
        const orig = tf.original
        if (target?.set && orig && typeof orig.left === 'number' && typeof orig.top === 'number') {
          target.set({ left: orig.left, top: orig.top })
          target.setCoords?.()
        }
        cAny._currentTransform = undefined
      }
      const shown = contextMenu.showAt(startX, startY, { touch: true })
      if (shown) firedThisGesture = true
      if (shown && haptic) {
        try {
          const nav = navigator as unknown as { vibrate?: (pattern: number) => boolean }
          nav.vibrate?.(10)
        } catch {
          /* 미지원/차단 브라우저 — 무해 */
        }
      }
    }, pressMs)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return
    if (pressTimer === null || !activePointers.has(e.pointerId)) return
    // T-2: 화면 px 이동이 임계 초과 → 취소(preventDefault 없이 스크롤/드래그 양보)
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > moveTolerancePx) {
      clearTimer()
    }
  }

  const onPointerUpCancel = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return
    activePointers.delete(e.pointerId)
    clearTimer()
    // T-5 보강: 이번 제스처에서 메뉴가 떠 있으면, 손 뗌 직후 도착할 합성 mousedown 이
    // (표시 시각 기준 창이 만료된 뒤라도) 메뉴를 닫지 않도록 억제창을 release 기준으로 재-arm.
    if (firedThisGesture) {
      contextMenu.armTouchHideSuppress()
      firedThisGesture = false
    }
  }

  wrapper.addEventListener('pointerdown', onPointerDown)
  wrapper.addEventListener('pointermove', onPointerMove)
  wrapper.addEventListener('pointerup', onPointerUpCancel)
  wrapper.addEventListener('pointercancel', onPointerUpCancel)

  return () => {
    clearTimer()
    activePointers.clear()
    wrapper.removeEventListener('pointerdown', onPointerDown)
    wrapper.removeEventListener('pointermove', onPointerMove)
    wrapper.removeEventListener('pointerup', onPointerUpCancel)
    wrapper.removeEventListener('pointercancel', onPointerUpCancel)
  }
}
