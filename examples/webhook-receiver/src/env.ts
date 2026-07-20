/**
 * 환경변수 파싱·검증 — **부팅 시 1회**.
 *
 * ## 🚨 `process.env.STORIGE_WEBHOOK_SECRET!` 를 쓰지 마라
 * `!`(non-null 단언)는 **타입만** 속인다. env 가 없으면 런타임 값은 그대로
 * `undefined` 이고, 그 상태로 SDK 팩토리에 넘기면 배포는 성공한 것처럼 보이다가
 * **첫 웹훅에서** 실패한다. 파트너 눈에는 "웹훅이 안 온다"로만 보인다.
 *
 * 여기서 검사하면 오설정이 **기동 실패**로 즉시 드러난다. SDK 팩토리도 같은
 * 이유로 secret 을 팩토리 호출 시점에 한 번 더 검증한다(이중 방어).
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `환경변수 ${name} 가 설정되지 않았습니다. .env.example 를 .env 로 복사해 채운 뒤 ` +
        '`node --env-file=.env src/server.ts` 로 실행하십시오.',
    );
  }
  return value.trim();
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return undefined;
  return value.trim();
}

/**
 * 유한한 숫자만 — `Number(process.env.X)` 는 값이 없거나 형식이 틀리면 조용히
 * NaN 을 낸다. `toleranceSec: NaN` 이면 `NaN > 0` 이 false 라 **replay 보호가
 * 통째로 꺼진다**(10년 전 캡처 서명도 통과). SDK 도 NaN 을 던지지만, 여기서
 * 먼저 걸러 원인이 env 임을 분명히 한다.
 */
function finiteNumber(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`환경변수 ${name} 는 0 이상의 유한한 숫자여야 합니다 (받은 값: ${raw})`);
  }
  return parsed;
}

function integer(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`환경변수 ${name} 는 양의 정수여야 합니다 (받은 값: ${raw})`);
  }
  return parsed;
}

export interface ExampleEnv {
  /** 🔒 v2 는 웹훅 config 발급 시 1회 노출된 whsec_..., v1 은 서버 WEBHOOK_SECRET 공유값 */
  webhookSecret: string;
  /** replay 허용 창(초). 좁힐수록 캡처 서명의 재생 가능 시간이 준다 */
  toleranceSec: number;
  port: number;
  path: string;
  /** 본문을 믿지 않고 재조회하려면 필요(선택 — 없으면 재조회를 건너뛴다) */
  apiKey: string | undefined;
  baseUrl: string | undefined;
}

export function loadEnv(): ExampleEnv {
  const apiKey = optional('STORIGE_API_KEY');
  const baseUrl = optional('STORIGE_BASE_URL');
  if ((apiKey === undefined) !== (baseUrl === undefined)) {
    throw new Error('STORIGE_API_KEY 와 STORIGE_BASE_URL 은 함께 설정하거나 함께 비워야 합니다');
  }

  return {
    webhookSecret: required('STORIGE_WEBHOOK_SECRET'),
    toleranceSec: finiteNumber('STORIGE_WEBHOOK_TOLERANCE_SEC', 300),
    port: integer('PORT', 4002),
    path: optional('STORIGE_WEBHOOK_PATH') ?? '/webhooks/storige',
    apiKey,
    baseUrl,
  };
}
