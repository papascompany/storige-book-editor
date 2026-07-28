/**
 * D14 (2026-07-28) — 호스트→편집기 수신 명령 계약 v1 의 inbound 신뢰 게이트 잠금.
 *
 * 배경: 수신 3종(getState/saveNow/setBackGuard)은 GUIDE 에 이미 산문으로 노출돼 있던
 * 사실상의 계약이며, 계약 v1 등재는 그 **사후 추인**이다. 등재 시점에 맞춰 편집기 수신부에
 * `e.source === window.parent` 대조를 **additive** 로 봉합했다 —
 * 기존 게이트(origin + 봉투 source)만으로는 parentOrigin 과 같은 출처의 다른 프레임/윈도우가
 * `saveNow` 를 강제하거나 `setBackGuard{enabled:false}` 로 이탈 가드를 풀 수 있었다.
 * (호스트측 SDK 는 expectedSource 필수화로 이미 대칭 방어 완료 — 편집기측만 비대칭이었음.)
 *
 * 본 테스트가 잠그는 것:
 *   ① 정상 부모(iframe·top-level 양쪽)가 보낸 명령은 **반드시 통과** — 既노출 발신자 호환
 *   ② 같은 출처의 다른 프레임/윈도우 발신은 차단
 *   ③ 미지원 command 의 조용한 no-op(strict additive) 유지
 *   ④ IIFE 인라인 마운트(top-level, `window.parent === window`) 경로 불파손
 *
 * EmbeddedEditor 의 무거운 초기화는 store.ready=true 선세팅으로 스킵된다
 * (embed.tsx init effect 의 `if (useAppStore.getState().ready) return` 가드) — deleteConfirm 테스트 준용.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

// ── 하위 UI 스텁 (검증 대상 아님) ──────────────────────────────────────────────
vi.mock('./components/editor/EditorHeader', () => ({ default: () => null }))
vi.mock('./components/editor/ToolBar', () => ({ default: () => null }))
vi.mock('./components/editor/ObjectActionBar', () => ({ default: () => null }))
vi.mock('./components/editor/FeatureSidebar', () => ({ default: () => null }))
vi.mock('./components/editor/ControlBar', () => ({ default: () => null }))
vi.mock('./components/editor/SidePanel', () => ({ default: () => null }))
vi.mock('./components/PageNavigation/BookNavigation', () => ({ BookNavigation: () => null }))
vi.mock('./components/PagePanel/SpreadPagePanel', () => ({ SpreadPagePanel: () => null }))
vi.mock('./components/modals', () => ({ WorkspaceModal: () => null }))
vi.mock('./components/RestoreBackupBanner', () => ({ RestoreBackupBanner: () => null }))
vi.mock('./components/editor/ObjectDeleteConfirm', () => ({ default: () => null }))

// ── 훅 스텁 — saveNow 호출/backGuard enabled 를 관측 지점으로 쓴다 ─────────────
const spies = vi.hoisted(() => ({
  saveNow: vi.fn(async () => undefined),
  backGuardEnabled: [] as boolean[],
}))

vi.mock('./hooks/useEditorContents', () => ({
  useEditorContents: () => ({ loadEmptyEditor: vi.fn(), loadTemplateSetEditor: vi.fn() }),
}))
vi.mock('./hooks/useEmbedAutoSave', () => ({
  useEmbedAutoSave: () => ({
    saveNow: spies.saveNow,
    restoreFromLocal: vi.fn(),
    evaluateRestore: () => ({ offer: false, confident: false }),
    deleteLocalBackup: vi.fn(),
  }),
}))
vi.mock('./hooks/useEmbedBackGuard', () => ({
  useEmbedBackGuard: (opts: { enabled: boolean }) => {
    spies.backGuardEnabled.push(opts.enabled)
    return undefined
  },
}))
vi.mock('./hooks/useCanvasContainerSizeSync', () => ({
  useCanvasContainerSizeSync: () => undefined,
}))
vi.mock('./hooks/useResolvedPageNavPosition', () => ({
  useResolvedPageNavPosition: () => 'bottom' as const,
}))

import {
  EmbeddedEditor,
  isTrustedHostCommandEvent,
  EMBED_HOST_MESSAGE_SOURCE,
  EMBED_MESSAGE_VERSION,
  type EditorInstanceMethods,
} from './embed'
import { useAppStore } from './stores/useAppStore'

const PARENT_ORIGIN = 'https://host.example'

// eslint globals 에 `Window`/`MessageEventSource` 식별자가 없어(no-undef) 값 기반 별칭을 쓴다.
type WindowLike = typeof window
type MessageSource = MessageEvent['source']

/** 다른 윈도우(형제 프레임·팝업 등) 스텁 — 항등 비교용 */
function makeWindowStub(tag: string): WindowLike {
  return { __tag: tag, postMessage: () => {} } as unknown as WindowLike
}

function hostEnvelope(command: string, payload?: unknown, requestId?: string) {
  return {
    source: EMBED_HOST_MESSAGE_SOURCE,
    version: EMBED_MESSAGE_VERSION,
    command,
    requestId,
    payload,
  }
}

function messageEvent(opts: {
  data: unknown
  origin?: string
  source: WindowLike | null
}): MessageEvent {
  return new MessageEvent('message', {
    data: opts.data,
    origin: opts.origin ?? PARENT_ORIGIN,
    source: opts.source as MessageSource,
  })
}

// ── ① 게이트 단위 테스트 ───────────────────────────────────────────────────────
describe('isTrustedHostCommandEvent (D14 inbound 게이트)', () => {
  const realParent = Object.getOwnPropertyDescriptor(window, 'parent')

  afterEach(() => {
    if (realParent) Object.defineProperty(window, 'parent', realParent)
    else Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'parent')
  })

  function setParent(w: WindowLike) {
    Object.defineProperty(window, 'parent', { value: w, configurable: true, writable: true })
  }

  it('iframe 임베드: 부모 윈도우 발신은 통과한다 (既노출 발신자 호환)', () => {
    const parent = makeWindowStub('parent')
    setParent(parent)
    expect(
      isTrustedHostCommandEvent(
        messageEvent({ data: hostEnvelope('saveNow'), source: parent }),
        PARENT_ORIGIN,
      ),
    ).toBe(true)
  })

  it('IIFE/top-level(window.parent === window): 같은 문서 self-post 도 통과한다', () => {
    expect(window.parent === window).toBe(true) // happy-dom 기본 = top-level 컨텍스트
    expect(
      isTrustedHostCommandEvent(
        messageEvent({ data: hostEnvelope('setBackGuard', { enabled: false }), source: window }),
        PARENT_ORIGIN,
      ),
    ).toBe(true)
  })

  it('같은 출처의 다른 프레임/윈도우 발신은 차단한다 (D14 핵심)', () => {
    const parent = makeWindowStub('parent')
    setParent(parent)
    const sibling = makeWindowStub('sibling') // origin 은 동일, 윈도우만 다름
    expect(
      isTrustedHostCommandEvent(
        messageEvent({ data: hostEnvelope('setBackGuard', { enabled: false }), source: sibling }),
        PARENT_ORIGIN,
      ),
    ).toBe(false)
  })

  it('e.source 가 null 이면 차단한다 (MessagePort/소실 윈도우 등)', () => {
    setParent(makeWindowStub('parent'))
    expect(
      isTrustedHostCommandEvent(
        messageEvent({ data: hostEnvelope('saveNow'), source: null }),
        PARENT_ORIGIN,
      ),
    ).toBe(false)
  })

  it('기존 게이트는 그대로 — origin 불일치·봉투 source 불일치·parentOrigin 미제공은 차단', () => {
    const parent = makeWindowStub('parent')
    setParent(parent)
    expect(
      isTrustedHostCommandEvent(
        messageEvent({ data: hostEnvelope('saveNow'), origin: 'https://evil.example', source: parent }),
        PARENT_ORIGIN,
      ),
    ).toBe(false)
    expect(
      isTrustedHostCommandEvent(
        messageEvent({ data: { source: 'storige-editor', command: 'saveNow' }, source: parent }),
        PARENT_ORIGIN,
      ),
    ).toBe(false)
    expect(
      isTrustedHostCommandEvent(messageEvent({ data: hostEnvelope('saveNow'), source: parent }), undefined),
    ).toBe(false)
  })
})

// ── ② 컴포넌트 배선 테스트 (실제 리스너) ───────────────────────────────────────
function renderEmbed() {
  const instanceRef = { current: null as EditorInstanceMethods | null }
  return render(
    <EmbeddedEditor
      templateSetId="ts-test"
      sessionId="sess-1"
      parentOrigin={PARENT_ORIGIN}
      instanceRef={instanceRef}
    />,
  )
}

function dispatch(data: unknown, source: WindowLike | null, origin = PARENT_ORIGIN) {
  act(() => {
    window.dispatchEvent(messageEvent({ data, origin, source }))
  })
}

/** saveNow 분기는 `Promise.resolve().then(...)` 로 한 틱 뒤에 실행된다 — 마이크로태스크 flush */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

/** useEmbedBackGuard 에 마지막으로 전달된 enabled (내부 backGuard 상태의 관측 지점) */
function lastBackGuardEnabled(): boolean {
  return spies.backGuardEnabled[spies.backGuardEnabled.length - 1]
}

describe('EmbeddedEditor 인바운드 명령 배선 (D14 · 계약 v1 3종)', () => {
  beforeEach(() => {
    spies.saveNow.mockClear()
    spies.backGuardEnabled.length = 0
    act(() => {
      useAppStore.setState({ ready: true, canvas: null, activeSelection: [] } as never)
    })
  })

  afterEach(() => {
    act(() => {
      useAppStore.setState({ ready: false, canvas: null, activeSelection: [] } as never)
    })
  })

  it('정상 부모(top-level = IIFE 인라인 마운트 경로)의 saveNow / setBackGuard 는 통과한다', async () => {
    renderEmbed()
    expect(lastBackGuardEnabled()).toBe(true) // 기본 가드 ON

    dispatch(hostEnvelope('saveNow', undefined, 'req-1'), window)
    await flush()
    expect(spies.saveNow).toHaveBeenCalledTimes(1)

    dispatch(hostEnvelope('setBackGuard', { enabled: false }), window)
    expect(lastBackGuardEnabled()).toBe(false) // 호스트가 가드 제어를 가져감

    dispatch(hostEnvelope('setBackGuard', { enabled: true }), window)
    expect(lastBackGuardEnabled()).toBe(true)
  })

  it('같은 출처의 다른 프레임이 보낸 saveNow / setBackGuard 는 무시된다', async () => {
    renderEmbed()
    const sibling = makeWindowStub('sibling')

    dispatch(hostEnvelope('saveNow', undefined, 'req-2'), sibling)
    await flush()
    expect(spies.saveNow).not.toHaveBeenCalled()

    // 가드 해제 시도 — 반영되면 안 된다
    dispatch(hostEnvelope('setBackGuard', { enabled: false }), sibling)
    expect(lastBackGuardEnabled()).toBe(true)
  })

  it('미지원 command 는 조용히 무시된다 (strict additive — throw 없음·부수효과 없음)', async () => {
    renderEmbed()
    expect(() => {
      dispatch(hostEnvelope('navigateToPage', { page: 3 }), window)
      dispatch(hostEnvelope('__nope__'), window)
    }).not.toThrow()
    await flush()
    expect(spies.saveNow).not.toHaveBeenCalled()
    expect(lastBackGuardEnabled()).toBe(true)
  })

  it('origin 불일치 메시지는 기존대로 차단된다 (회귀 방지)', async () => {
    renderEmbed()
    dispatch(hostEnvelope('saveNow'), window, 'https://evil.example')
    await flush()
    expect(spies.saveNow).not.toHaveBeenCalled()
  })
})
