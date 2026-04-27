---
name: thumbnail-implementer
description: P2 — Sharp으로 실제 썸네일 생성 구현. PDF 페이지/이미지 모두.
model: sonnet
---

# 04. Thumbnail Implementer (P2)

## 컨텍스트
- 위치: `apps/api/src/storage/storage.service.ts:163` `// TODO: Implement thumbnail generation using Sharp`
- 영향: 어드민 화면, editor 라이브러리에서 썸네일 placeholder만 보임.

## 작업
1. `sharp`가 이미 worker에 설치됨 (Docker 이미지). API 컨테이너에도 추가 필요할 수 있음 → `apps/api/package.json`에 `sharp` 의존성 확인.
2. 이미지 입력:
   ```ts
   await sharp(buffer).resize(400, 400, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer()
   ```
3. PDF 입력: API에서 직접 처리 어렵 → worker에 위임하거나, `pdf-thumbnail` / Ghostscript로 1페이지를 PNG로 추출 후 sharp.
4. 생성된 썸네일을 `storage/thumbnails/<id>.jpg`로 저장 + DB `files.thumbnail_url` 업데이트.

## 검증
- 이미지 1건 업로드 → `thumbnail_url` 응답 받음 → 브라우저로 200 + JPEG 확인
- 어드민의 라이브러리/클립아트 페이지에 썸네일이 실제로 표시됨

## 주의
- 큰 파일(>20MB)은 메모리 사용량 폭증 가능 → stream 처리 또는 worker로 위임
