/**
 * 실행 진입점 — env 를 읽어 실제 서버에 주문을 넣는다.
 *
 *   cp .env.example .env   # 값 채우기
 *   node --env-file=.env src/main.ts
 *
 * 라이브 키 없이 호출 시퀀스만 보고 싶으면 `node src/verify.ts` 를 쓴다.
 */

import { mkdir, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import { StorigeApiError, StorigeConnectionError, StorigeUsageError } from '@storige/sdk';
import { StorigeClient } from '@storige/sdk/client';
import type { AssetInput } from '@storige/sdk/client';

import { loadEnv } from './env.ts';
import { runPdfUploadOrder } from './order.ts';

async function main(): Promise<void> {
  const env = loadEnv();

  const client = new StorigeClient({
    apiKey: env.apiKey,
    baseUrl: env.baseUrl,
    // 진단용 UA 접미 — 서버 로그에서 파트너 통합을 구분할 수 있다.
    userAgent: 'storige-example-pdf-upload-order/0.0.0',
  });

  const outcome = await runPdfUploadOrder(client, {
    bookSpecUid: env.bookSpecUid,
    pageCount: env.pageCount,
    partnerRef: env.partnerRef,
    title: `예제 주문 ${env.partnerRef}`,
    cover: await toAssetInput(env.coverFileId, env.coverPdfPath, 'cover.pdf'),
    contents: await toAssetInput(env.contentsFileId, env.contentsPdfPath, 'contents.pdf'),
    skipPolling: env.skipPolling,
  });

  if (outcome.kind === 'completed') {
    // 스트림을 그대로 파일로 흘린다 — 2GB 산출물도 상수 메모리로 받는다.
    // (`await response.arrayBuffer()` 같은 전량 버퍼링은 여기서 하지 말 것)
    await mkdir(dirname(env.outputPdfPath), { recursive: true });
    await pipeline(Readable.fromWeb(outcome.pdf.stream), createWriteStream(env.outputPdfPath));
    console.log(`✓ 저장 완료 — ${env.outputPdfPath}`);
    return;
  }

  if (outcome.kind === 'failed') {
    console.error(`✗ 최종화 실패 — errorCode=${outcome.finalization.errorCode}`);
    process.exitCode = 1;
    return;
  }

  console.log(`… 최종화 진행 중 — 완료는 웹훅으로 통지된다 (bookUid=${outcome.book.uid})`);
}

/** fileId 참조(권장) 우선, 없으면 로컬 PDF 직접 업로드 */
async function toAssetInput(
  fileId: string | undefined,
  path: string | undefined,
  filename: string,
): Promise<AssetInput> {
  if (fileId !== undefined) return { fileId };
  if (path === undefined) throw new Error('fileId 도 경로도 없습니다');
  const data = await readFile(path);
  return { file: { data, filename, contentType: 'application/pdf' } };
}

main().catch((error: unknown) => {
  // 에러 3종 분류가 곧 대응 방법이다.
  if (error instanceof StorigeApiError) {
    console.error(
      `✗ API 오류 ${error.status} ${error.errorCode} — ${error.message}` +
        (error.requestId !== null ? ` (requestId=${error.requestId})` : ''),
    );
    if (error.fieldErrors !== null) console.error('  필드 위반:', error.fieldErrors);
    if (error.errors.length > 0) console.error('  상세:', error.errors);
  } else if (error instanceof StorigeConnectionError) {
    console.error(`✗ 연결 실패 — ${error.message}`);
  } else if (error instanceof StorigeUsageError) {
    console.error(`✗ SDK 사용법 오류 — ${error.message}`);
  } else {
    console.error('✗', error);
  }
  process.exitCode = 1;
});
