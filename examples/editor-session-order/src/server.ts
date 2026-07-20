/**
 * 호스트 서버 — 정적 페이지 + 작은 서버 엔드포인트 3개.
 *
 *   GET  /               public/index.html (iframe 호스트 페이지)
 *   POST /api/session    데모 로그인(부팅 nonce 대조) → httpOnly 세션 쿠키
 *   GET  /api/config     🔒 세션 필요 — **요청자 몫의** 편집기 URL(토큰 포함)
 *   POST /api/promote    🔒 세션 필요 + 파트너 키로 세션 승격 + 최종화 착수
 *
 * ## 구조가 곧 보안 경계다
 * 파트너 API 키는 이 프로세스에만 있다. 브라우저는 sessionId 를 서버로 **보내기만**
 * 하고, 실제 승격은 서버가 자기 키로 수행한다. 키를 프런트로 내리면 그 키를 얻은
 * 누구나 테넌트 전체의 도서를 만들고 읽을 수 있다.
 *
 * ## 🔒 토큰을 내려주는 엔드포인트는 무인증이면 안 된다
 * `/api/config` 는 편집기 **회원 JWT** 가 박힌 embed URL 을 준다. 무인증으로 열어 두면
 * 그 URL 을 아는 누구나 세션 토큰을 받아 가는 자판기가 된다 — 데모 토큰일 때는
 * 무해해 보이지만, 파트너는 이 모양을 복사한 뒤 **정적 토큰만 로그인 사용자 토큰으로
 * 갈아끼운다**. 그래서 세션 게이트를 먼저 세우고, 토큰은 `resolveEditorTokenFor(user)`
 * 로 **요청자 기준** 발급한다(`src/host-session.ts` 참조).
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import express from 'express';
import type { Request, Response } from 'express';
import { StorigeClient } from '@storige/sdk/client';

import { loadEnv } from './env.ts';
import { createHostSessions, type HostUser } from './host-session.ts';
import { PromoteRejected, promoteSession } from './promote.ts';

const env = loadEnv();
const sessions = createHostSessions();

const client = new StorigeClient({
  apiKey: env.server.apiKey,
  baseUrl: env.server.baseUrl,
  userAgent: 'storige-example-editor-session-order/0.0.0',
});

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const app = express();
app.use(express.json());
app.use(express.static(publicDir));

/**
 * 요청자 몫의 편집기 토큰.
 *
 * ⚠️ **이 데모는 회원이 1명뿐이라 env 의 정적 토큰을 그대로 쓴다.** 파트너는 여기를
 *    "이 회원의 편집기 토큰을 발급/조회"로 바꿔야 한다 — 안 바꾸고 로그인만 붙이면
 *    모든 회원이 같은 세션을 공유하게 된다. 시그니처가 `user` 를 받는 이유가 그것이다.
 */
function resolveEditorTokenFor(_user: HostUser): string | undefined {
  return env.server.editorToken;
}

/** 세션 게이트 — 없으면 401. 파트너는 자기 세션 미들웨어로 교체한다 */
function requireHostSession(req: Request, res: Response): HostUser | null {
  const user = sessions.resolve(req.headers.cookie);
  if (user === null) {
    res.status(401).json({ error: 'AUTH_REQUIRED' });
    return null;
  }
  return user;
}

/**
 * 데모 로그인 — 부팅 시 콘솔에 찍힌 1회용 nonce 를 대조한다.
 * 진짜 인증이 아니다(= 서버 콘솔을 읽을 수 있었는가). 무인증 로그인 엔드포인트를
 * 열어 두면 게이트가 장식이 되므로 **일부러** 이 형태로 닫아 뒀다.
 */
app.post('/api/session', (req, res) => {
  const nonce: unknown = (req.body as { nonce?: unknown } | undefined)?.nonce;
  const sid = sessions.login(nonce);
  if (sid === null) {
    res.status(401).json({ error: 'INVALID_LOGIN_NONCE' });
    return;
  }
  res.cookie(sessions.cookieName, sid, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // 운영은 https 이므로 secure: true. 데모는 http://localhost 라 끈다.
    secure: env.hostOrigin.startsWith('https://'),
  });
  res.json({ ok: true });
});

/**
 * 🔒 **세션 필요.** 편집기 URL 에는 회원 JWT 가 실린다 → 요청자별로만 발급한다.
 * (`env.browser` 는 공개 값 전용 버킷이라 토큰이 애초에 들어 있지 않다)
 */
app.get('/api/config', (req, res) => {
  const user = requireHostSession(req, res);
  if (user === null) return;

  const token = resolveEditorTokenFor(user);
  res.json({
    ...env.browser,
    embedUrl: env.buildEmbedUrl(token),
    // 토큰이 없으면 게스트 세션이다 — 편집은 되지만 승격은 404 다.
    // 호스트 페이지가 이 값으로 미리 고지한다(완료 시점에 처음 알면 늦다).
    guest: token === undefined,
  });
});

app.post('/api/promote', async (req, res) => {
  const user = requireHostSession(req, res);
  if (user === null) return;

  const sessionId: unknown = (req.body as { sessionId?: unknown } | undefined)?.sessionId;
  if (typeof sessionId !== 'string' || sessionId === '') {
    res.status(400).json({ error: 'SESSION_ID_REQUIRED' });
    return;
  }

  // ⚠️ 운영에서는 여기서 **소유 검증**을 하라 — "로그인한 사용자(`user.id`)의 주문에
  //    실제로 묶인 sessionId 인가". 서버는 테넌트(site) 경계만 지키므로, 같은 사이트의
  //    다른 고객 세션은 이 엔드포인트가 막지 않으면 승격될 수 있다.
  //    (데모라 생략했다. 생략했다는 사실 자체를 남긴다.)

  try {
    const result = await promoteSession(client, {
      sessionId,
      partnerRef: `demo-${Date.now()}`,
      title: '임베드 편집 주문',
      // ⚠️ 미전달이면 미검증 FINALIZED 가 된다 — promote.ts 의 D-9 주석 참조
      bookSpecUid: env.server.bookSpecUid,
    });
    res.json({
      bookUid: result.book.uid,
      finalizationUid: result.finalization.uid,
      finalizationStatus: result.finalization.status,
      willSkipValidation: result.willSkipValidation,
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
  console.log(`편집기 오리진  ${env.browser.editorOrigin}`);
  if (env.server.editorToken === undefined) {
    console.log('⚠️ STORIGE_EDITOR_TOKEN 미설정 — 게스트 모드로 뜬다(편집은 되지만 승격은 404)');
  }
  if (env.server.bookSpecUid === undefined) {
    console.log('⚠️ STORIGE_BOOK_SPEC_UID 미설정 — 미검증 FINALIZED 로 최종화된다(D-9)');
  }
  console.log('\n아래 **1회용 로그인 URL** 을 브라우저로 열어라(무인증 접근은 401):');
  console.log(`  ${env.hostOrigin}/#demo=${sessions.bootNonce}\n`);
});
