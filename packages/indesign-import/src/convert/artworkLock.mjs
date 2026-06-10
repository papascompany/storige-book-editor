// 하이브리드 배경 아트워크(IDML/PSD) 를 표지/페이지 판형에 '고정'하는 fabric 잠금 속성 묶음.
// IDML(index.mjs idml-artwork) 과 PSD(toSinglePageTemplate.mjs psd-artwork) 가 공유 — 두 경로의
// 잠금 동작이 드리프트하지 않도록 단일 출처로 둔다.
//
// 의도:
// - selectable/evented:false → 클릭·선택 불가(편집은 위에 깔린 텍스트 오버레이만).
// - lock*/hasControls/hasBorders → 이동·회전·스케일·핸들 전부 차단.
// - extensionType 'template-element' → 레이어 패널 숨김 + 로드 시 isUserAdded=false 재판정 고정
//   (TemplatePlugin.isTemplateElement). excludeFromExport 는 두지 않음 → PDF/썸네일 정상 포함.
// - lockInfo lockLevel 'admin' → 고객 차단, 관리자 권한 경로에서만 해제(LockPlugin/ObjectPlugin.del).
// - deleteable:false → 비-관리자 삭제 차단.
//
// 이 속성들은 canvas-core extendFabricOption 화이트리스트에 모두 포함되어 저장(toJSON) →
// 로드(loadFromJSON) 라운드트립에서 보존된다. (배경 교체는 재가져오기 플로우로.)
export const ARTWORK_LOCK = {
  selectable: false,
  evented: false,
  hasControls: false,
  hasBorders: false,
  lockMovementX: true,
  lockMovementY: true,
  lockRotation: true,
  lockScalingX: true,
  lockScalingY: true,
  editable: false,
  deleteable: false,
  extensionType: 'template-element',
  lockInfo: { isLocked: true, lockLevel: 'admin', reason: 'IDML/PSD 배경 아트워크 (판형 고정)' },
};
