다시 확인한 결론은 이렇습니다. 마이그레이션의 큰 방향은 “기존 PHP 연동 계약은 유지하고, Storige 쪽 API/Editor/Admin/Worker/Storage만 새 레포와 VPS로 이관”이 맞습니다. 다만 최근 구현 중 일부가 기존 계약과 다른 방향으로 해석될 수 있는 지점이 있습니다. 그 부분만 정확히 고치면 됩니다.

기존 PHP 연동 계약
기존 문서와 test-php 기준으로 PHP 연동의 핵심은 다음입니다.

PHP 서버는 X-API-Key로 Storige API를 호출합니다.
PHP는 에디터용 JWT를 발급받아 에디터 번들에 넘깁니다.
에디터는 JWT로 edit-sessions를 생성/저장/완료합니다.
편집 완료 후 PHP는 sessionId, coverFileId, contentFileId를 바탕으로 POST /api/worker-jobs/synthesize/external를 호출합니다.
Worker 결과는 callbackUrl로 PHP webhook에 전송됩니다.
webhook payload는 기본적으로 jobId, orderId, status, outputFileUrl, outputFiles, outputFormat, errorMessage 중심입니다.
즉, 편집 완료가 곧바로 운영 주문 합성을 자동 실행한다기보다, PHP가 기존 주문 플로우 안에서 외부 synthesis API를 호출하는 구조가 원래 계약에 가깝습니다.

저장소 방향 검증
스토리지 마이그레이션 방향도 큰 틀에서는 맞습니다.

기존 PHP 웹서버의 파일 저장 방식을 PHP 내부에서 직접 유지하는 것이 아니라, PHP는 API로 파일을 올리고 Storige VPS가 저장합니다. 이때 고객 업로드 PDF와 워커 처리 대상 PDF는 반드시 FilesService를 거쳐야 합니다.

고객/주문/워커 PDF: /api/files/upload 또는 /api/files/upload/external
저장 위치: VPS ./storage/uploads, 컨테이너 내부 /app/storage/uploads
DB: files 테이블
Worker 입력: files.filePath
반면 편집 중 JSON, 썸네일, 디자인 에셋은 StorageService 경로입니다.

편집 JSON/썸네일/디자인 에셋: /api/storage/upload/designs
저장 위치: /app/storage/designs
DB: files 테이블에 저장되지 않음
따라서 제가 앞서 지적한 storageApi.uploadDesign() 문제는 방향성 검토 후에도 유효합니다. 다만 의미를 더 정확히 말하면, uploadDesign() 자체가 문제인 것이 아니라, 그 결과 UUID를 coverFileId/contentFileId로 쓰는 것이 문제입니다.

기존 방향과 어긋나는 지점
1. completeSpreadWork의 완료 PDF 업로드
apps/editor/src/hooks/useWorkSave.ts의 spread 완료 흐름은 PDF를 storageApi.uploadDesign()으로 올리고, 그 id를 coverFileId/contentFileId에 넣습니다. 이건 기존 연동 계약과 맞지 않습니다.

수정 방향:

편집 완료 PDF는 filesApi.upload()로 올려야 합니다.
type은 백엔드 enum에 맞춰 cover 또는 content로 저장해야 합니다.
metadata에는 최소한 generatedBy: 'editor', editSessionId, mode, orderSeqno를 넣는 것이 맞습니다.
2. 기존 PHP synthesis 흐름을 대체하면 안 됨
P5의 /api/editor/export는 내부 편의 API 또는 추가 기능으로 볼 수는 있지만, 기존 PHP 계약의 주 경로는 여전히 /api/worker-jobs/synthesize/external입니다.

수정 방향:

PHP 기존 코드는 가능하면 그대로 두고, API 쪽에서 기존 external endpoint 계약을 보존해야 합니다.
“편집 완료 시 자동 synthesis”를 PHP 기존 주문 플로우의 대체물로 만들면 방향이 달라집니다.
자동 생성이 필요하다면 옵션성 기능으로 두고, PHP 회귀 테스트의 기준은 external synthesis API로 잡는 것이 안전합니다.
3. webhook payload는 기존 필드를 유지해야 함
제가 앞서 sessionId 누락을 지적했지만, 기존 문서와 test-php/php/webhook.php를 다시 보면 PHP 쪽은 주로 jobId, outputFileUrl, outputFiles, outputFormat, errorMessage를 기대합니다. 따라서 sessionId는 필수로 강제할 항목이 아닙니다.

수정 방향:

기존 payload 필드는 절대 제거하지 않습니다.
sessionId가 필요하면 추가 필드로만 넣습니다.
PHP webhook을 sessionId 필수로 바꾸는 것은 기존 계약 유지 방향과 맞지 않습니다.
4. Worker status PATCH 경로는 반드시 수정 필요
이건 기존 PHP 계약과 무관하게 Worker 운영 안정성 문제입니다. validation은 /worker-jobs/external/:id/status를 쓰는데, synthesis/conversion은 /worker-jobs/:id/status를 씁니다. API Key 인증과 맞지 않아 상태 반영과 webhook 발송이 실패할 수 있습니다.

수정 방향:

SynthesisProcessor, ConversionProcessor도 API Key 인증이 걸린 external status endpoint를 사용하게 맞춥니다.
또는 내부 status endpoint에 Worker 전용 guard를 명확히 둡니다.
기존 PHP 코드는 건드릴 필요 없습니다.
5. embed.tsx의 type: 'design' 가능성
embed.tsx는 완료 PDF 업로드 시 filesApi.upload()를 써서 방향은 맞습니다. 다만 mode가 cover/content가 아닐 때 type: 'design'을 보낼 수 있는데, 백엔드 FileType enum에는 design이 없습니다.

수정 방향:

FileType enum과 프론트 FileType 타입을 일치시킵니다.
워커 대상이 아닌 디자인 에셋은 storageApi, 워커 대상 PDF는 filesApi로 분리합니다.
both/template 모드에서 생성한 PDF를 표지로 볼지, content로 볼지, split 대상으로 볼지 정책을 고정해야 합니다.
최종 판단
현재 진행 방향은 대체로 맞습니다. PHP 웹쇼핑몰의 기존 연동방식은 유지하고, Storige 쪽 새 API/Worker/VPS 스토리지로 이관하는 구조입니다. 수정해야 할 내용도 이 방향과 충돌하지 않습니다.

정확히 수정해야 할 것은 PHP 계약 변경이 아니라 다음입니다.

completeSpreadWork의 완료 PDF 업로드를 storageApi.uploadDesign()에서 filesApi.upload()로 변경.
files metadata에 generatedBy: 'editor', editSessionId를 저장해 spread/split worker 검증과 맞춤.
SynthesisProcessor/ConversionProcessor의 status PATCH 인증 경로 정리.
webhook payload는 기존 jobId/orderId/outputFileUrl/outputFiles 계약을 유지하고, 새 필드는 additive로만 추가.
/api/editor/export나 자동 synthesis를 기존 PHP /worker-jobs/synthesize/external 플로우의 대체물로 간주하지 않기.
즉, “기존 PHP 방식을 바꾸지 않는다”는 계획 기준으로 보면, 앞서 분석한 수정 사항 중 스토리지 업로드 경로와 Worker status PATCH는 반드시 고쳐야 하는 내부 이관 문제이고, webhook/sessionId나 자동 synthesis 쪽은 기존 PHP 계약을 깨지 않도록 조심해서 정리해야 하는 계약 보존 문제입니다.