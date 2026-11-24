import { fabric } from 'fabric'

/**
 * fabric 5 의 group.removeWithUpdate 를 여러 객체에 한 번에 적용한다.
 *
 * removeWithUpdate 는 호출마다 남은 자식 전체를 절대 좌표로 풀었다가(_restoreObjectsState) 경계를 다시 재고
 * 그룹 좌표로 되돌린다(_updateObjectsCoords). 자식 n개 그룹에서 k개를 하나씩 빼면 O(n·k) 가 된다
 * (PDF 텍스트 벡터화에서 글자 460개 그룹 약 1.3초). 같은 단계를 한 번만 밟아 결과는 같고 O(n) 이다.
 * 빠진 객체는 removeWithUpdate 와 같이 그룹 변환이 반영된 좌표를 갖고 group 참조가 지워진다.
 */
export function removeObjectsWithUpdate(group: fabric.Group, objects: fabric.Object[]): void {
  if (objects.length === 0) return
  group._restoreObjectsState()
  fabric.util.resetObjectTransform(group)
  group.remove(...objects)
  group._calcBounds()
  group._updateObjectsCoords()
  group.setCoords()
  group.dirty = true
}
