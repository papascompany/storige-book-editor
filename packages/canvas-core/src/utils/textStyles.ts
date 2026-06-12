// fabric 5.5.2 `fabric.util.stylesToArray` 잠복 병합 버그 패치 (dist 1878-1913).
//
// 결함: 무스타일 라인 스킵 분기(`if (!styles[i]) { charIndex += len; continue }`)에서
// prevStyle 이 리셋되지 않는다. 그래서 "스타일 라인 → 스타일 없는 라인 → 직전과 동일한
// 스타일로 시작하는 라인" 패턴에서 hasStyleChanged 가 false 가 되어, 새 엔트리를 만들지
// 않고 직전 범위의 end++ 로 병합된다. 스킵된 라인의 글자 수만큼 charIndex 가 건너뛰었으므로
// 병합된 [start, end) 범위는 실제로는 중간의 무스타일 글자들을 포함하게 된다.
//
// 실측 재현 (fabric 5.5.2 dist, node):
//   text   '제목\n본문본문본문\n부제'
//   styles { 0: {0:D,1:D}, 2: {0:D,1:D} }            (1·3라인 동일 스타일 D)
//   1차 저장(toObject→stylesToArray) → [{start:0,end:4,style:D}]  단일 범위(오염)
//   리로드(stylesFromArray)          → '본문' 첫 2글자에 스타일 전이 + '부제' 스타일 소실.
//   크래시/경고 없는 조용한 데이터 오염으로, 저장→재편집 왕복마다 인쇄물에 직결된다.
//
// 수정: 스킵 분기에서 prevStyle = {} 리셋 1줄. 라인이 스킵되면 범위 연속성이 끊기므로
// 다음 스타일 글자는 항상 새 엔트리로 시작해야 한다. 그 외 로직·시그니처·반환 형태는
// dist 원본과 동일하게 보존한다 (클론, hasStyleChanged(…, true), {start,end,style}[]).
//
// 참고: 컨버터(indesign-import)측에서 갭 라인에 빈 {} 를 주입하는 우회는 리로드의
// stylesFromArray 가 빈 라인 엔트리를 떨궈 2차 저장에서 재발(UNSTABLE 실측) — 채택 금지.
// 직렬화 경로는 전부 호출 시점에 fabric.util.stylesToArray 를 조회하므로
// (Text#toObject → toJSON/toDatalessJSON, dist 27403) util 교체만으로 전 경로가 커버된다.
import { fabric } from 'fabric'

const PATCH_FLAG = '__storigeStylesToArrayGapFix'

type TextStyleRange = { start: number; end: number; style: Record<string, unknown> }

/**
 * fabric.util.stylesToArray 를 갭 라인 prevStyle 리셋이 적용된 구현으로 교체한다.
 * 멱등(재호출/중복 import 안전). 모듈 로드 시 자동 실행된다.
 */
export function patchFabricStylesToArray(): void {
  const util = fabric.util as any
  if (util[PATCH_FLAG]) return

  util.stylesToArray = function (styles: Record<string, any>, text: string): TextStyleRange[] {
    // ↓ 이하 fabric 5.5.2 dist 원본(1878-1913)과 동일 — prevStyle 리셋 1줄만 추가
    // clone style structure to prevent mutation
    // (@types/fabric 이 clone 을 1-인자로 선언해 any 별칭으로 호출 — 런타임은 dist 와 동일한 deep clone)
    const cloned = util.object.clone(styles, true)
    const textLines = text.split('\n')
    let charIndex = -1
    let prevStyle: Record<string, any> = {}
    const stylesArray: TextStyleRange[] = []
    // loop through each textLine
    for (let i = 0; i < textLines.length; i++) {
      if (!cloned[i]) {
        // no styles exist for this line, so add the line's length to the charIndex total
        charIndex += textLines[i].length
        // [패치] 라인 스킵으로 범위 연속성이 끊김 — 다음 스타일 글자가 직전 범위에
        // 병합(end++)되지 않도록 prevStyle 을 리셋해 항상 새 엔트리로 시작시킨다.
        prevStyle = {}
        continue
      }
      // loop through each character of the current line
      for (let c = 0; c < textLines[i].length; c++) {
        charIndex++
        const thisStyle = cloned[i][c]
        // check if style exists for this character
        if (thisStyle && Object.keys(thisStyle).length > 0) {
          const styleChanged = util.hasStyleChanged(prevStyle, thisStyle, true)
          if (styleChanged) {
            stylesArray.push({
              start: charIndex,
              end: charIndex + 1,
              style: thisStyle
            })
          } else {
            // if style is the same as previous character, increase end index
            stylesArray[stylesArray.length - 1].end++
          }
        }
        prevStyle = thisStyle || {}
      }
    }
    return stylesArray
  }

  util[PATCH_FLAG] = true
}

// history.ts 등 utils/ 의 prototype 패치 파일들과 동일하게 모듈 로드 부수효과로 부착
patchFabricStylesToArray()
