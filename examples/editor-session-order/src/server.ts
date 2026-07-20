/**
 * 호스트 서버 — 정적 페이지 + 작은 서버 엔드포인트 2개.
 *
 *   GET  /               public/index.html (iframe 호스트 페이지)
 *   GET  /api/config     브라우저가 쓸 공개 설정(편집기 URL·허용 오리진)
 *   POST /api/promote    🔒 파트너 키로 세션 승격 + 최종화 착수
 *
 * ## 구조가 곧 보안 경계다
 * 파트너 API 키는 이 프로세스에만 있다. 브라우저는 sessionId 를 서버로 **보내기만**
 * 하고, 실제 승격은 서버가 자기 키로 수행한다. 키를 프런트로 내리면 그 키를 얻은
 * 누구나 테넌트 전체의 도서를 만들고 읽을 수 있다.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import express from 'express';
import { StorigeClient } from '@storige/sdk/client';

import { loadEnv } from './env.ts';
import { PromoteRejected, promoteSession } from './promote.ts';

const env = loadEnv();

const client = new StorigeClient({
  apiKey: env.server.apiKey,
  baseUrl: env.server.baseUrl,
  userAgent: 'storige-example-editor-session-order/0.0.0',
});

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const app = express();
app.use(express.json());
app.use(express.static(publicDir));

/** 브라우저에 내려도 되는 값만 — 키는 여기 없다 */
app.get('/api/config', (_req, res) => {
  res.json(env.browser);
});

app.post('/api/promote', async (req, res) => {
  const sessionId: unknown = (req.body as { sessionId?: unknown } | undefined)?.sessionId;
  if (typeof sessionId !== 'string' || sessionId === '') {
    res.status(400).json({ error: 'SESSION_ID_REQUIRED' });
    return;
  }

  // ⚠️ 운영에서는 여기서 **소유 검증**을 하라 — "로그인한 사용자의 주문에 실제로
  //    묶인 sessionId 인가". 서버는 테넌트(site) 경계만 지키므로, 같은 사이트의
  //    다른 고객 세션은 이 엔드포인트가 막지 않으면 승격될 수 있다.
  //    (데모라 생략했다. 생략했다는 사실 자체를 남긴다.)

  try {
    const result = await promoteSession(client, {
      sessionId,
      partnerRef: `demo-${Date.now()}`,
      title: '임베드 편집 주문',
    });
    res.json({
      bookUid: result.book.uid,
      finalizationUid: result.finalization.uid,
      finalizationStatus: result.finalization.status,
    });
  } catch (error) {
    if (error instanceof PromoteRejected) {
      // 사유 코드만 내려보낸다 — 서버 message 를 그대로 흘리면 존재 은닉이 깨진다
      res.status(error.status).json({ error: error.reason });
      return;
    }
    console.error('[promote] 예상 못 한 오류:', error);
    res.status(500).json({ error: 'INTERNAL' });
  }
});

app.listen(env.port, () => {
  console.log(`호스트 페이지  ${env.hostOrigin}`);
  console.log(`편집기 오리진  ${env.browser.editorOrigin}`);
  console.log('브라우저에서 위 주소를 열고 편집을 완료하면 서버가 세션을 승격한다.');
});
