import type { fabric } from 'fabric'
import type { FontPlugin } from '@storige/canvas-core'
import type Editor from '@storige/canvas-core'

/**
 * 복원된 캔버스의 미등록 폰트를 기본 폰트로 정규화한다.
 *
 * 임베드 세션·로컬 백업 복원은 `core.loadFromJSON`(순수 fabric 로드)을 써서 FontPlugin 의
 * 객체 폰트 적용(applyFontToObject)을 거치지 않는다. 그래서 저장본의 'Times New Roman' 같은
 * 미등록 패밀리가 화면에는 브라우저 대체 글꼴로 남고 PDF 에서만 기본 폰트로 벡터화돼 화면과
 * 출력이 달라졌다. 복원 직후 호출해 FontPlugin.normalizeCanvasFonts 로 같은 규칙을 적용한다.
 *
 * FontPlugin 이 없거나(테스트 더블·구형 에디터) 예외가 나도 복원 자체는 계속된다 — 순수 화면
 * 정합 처리이며 저장/완료 흐름을 막지 않는다. 변경된 텍스트 객체 수를 돌려준다.
 */
export function normalizeRestoredFonts(
  editor: Editor | null | undefined,
  canvas: fabric.Canvas | null | undefined,
): number {
  if (!editor || !canvas) return 0
  try {
    const fontPlugin = editor.getPlugin<FontPlugin>('FontPlugin')
    if (!fontPlugin || typeof fontPlugin.normalizeCanvasFonts !== 'function') return 0
    return fontPlugin.normalizeCanvasFonts(canvas)
  } catch (err) {
    console.warn('[fontRestore] 복원 폰트 정규화 실패(계속 진행):', err)
    return 0
  }
}
