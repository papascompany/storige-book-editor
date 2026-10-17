/**
 * dev-log-transport.ts — 개발 모드 pino 전송기 선택 (2026-10-17)
 *
 * production 은 JSON 한 줄(전송기 없음). 개발 모드는 `pino-pretty` 가 **설치돼 있을 때만** pretty 로 보내고,
 * 없으면 JSON 으로 기동한다(종전에는 `target:'pino-pretty'` 하드코딩이라 미설치 환경에서 부팅이 죽었다 —
 * `unable to determine transport target for "pino-pretty"`). pino-pretty 는 어느 package.json 에도 없고
 * 저장소 의존성 추가는 lockfile 재해석을 끌고 오므로, 설치 여부를 런타임에 판정한다.
 *
 * - target 은 **절대 경로**로 넘긴다: pino 는 상대 이름을 호출자(nestjs-pino 실경로) 기준으로 해석해
 *   앱 쪽 node_modules 에만 있는 패키지를 못 찾을 수 있다. 절대 경로는 그대로 쓴다.
 * - `LOG_PRETTY=false|0|off` 면 개발 모드에서도 JSON(로그 수집·파이프용).
 * - pretty 출력이 필요하면 설치 없이 `pnpm --filter @storige/api dev | npx pino-pretty` 로도 된다.
 */

export interface DevLogTransport {
  target: string;
  options: { singleLine: boolean; translateTime: string };
}

export interface ResolveDevLogTransportInput {
  nodeEnv: string | undefined;
  /** LOG_PRETTY 환경변수 원문 */
  logPretty: string | undefined;
  /** `pino-pretty` 의 절대 경로를 돌려주거나 throw (기본: require.resolve) */
  resolvePretty?: () => string;
  warn?: (message: string) => void;
}

const PRETTY_OFF = new Set(['false', '0', 'off', 'no']);

export function resolveDevLogTransport(input: ResolveDevLogTransportInput): DevLogTransport | undefined {
  if (input.nodeEnv === 'production') return undefined;
  if (input.logPretty !== undefined && PRETTY_OFF.has(input.logPretty.trim().toLowerCase())) return undefined;
  const resolvePretty = input.resolvePretty ?? (() => require.resolve('pino-pretty'));
  try {
    return { target: resolvePretty(), options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } };
  } catch {
    (input.warn ?? ((m: string) => console.warn(m)))(
      '[logger] pino-pretty 가 설치돼 있지 않아 JSON 로그로 기동합니다 — pretty 출력은 `| npx pino-pretty` 로 파이프하거나 pino-pretty 를 설치하세요',
    );
    return undefined;
  }
}
