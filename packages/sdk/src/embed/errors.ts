/**
 * `./embed` 전용 에러 — 루트 `StorigeError` 계열을 상속한다.
 *
 * ## 타임아웃을 "실패"로 뭉개지 않는다 (계약 §확장 규약)
 * 편집기는 **미지원 command 를 조용히 무시(no-op)** 한다 — 오류 이벤트도 예외도 보내지
 * 않는다(`embed.tsx` `default: break`). 그래서 호스트는 **응답 타임아웃으로 미지원을
 * 판정하되 실패로 취급하면 안 된다**(구버전 편집기 ↔ 신버전 호스트 조합에서 정상 동작).
 *
 * 그런데 "응답이 없다"에는 원인이 셋이고 셋을 한 에러로 뭉치면 판정이 불가능하다:
 *
 * | 상황 | 에러 | 의미 |
 * |---|---|---|
 * | `editor.ready` 를 본 뒤 명령을 보냈는데 무응답 | {@link EditorCommandUnsupportedError} | **미지원** — 실패 아님. 기능을 끄고 진행하라 |
 * | `editor.ready` 자체가 안 옴 | {@link EditorNotReadyError} | 편집기가 아직/영영 준비되지 않음 — 미지원 판정 **아님** |
 * | 편집기가 명시적으로 실패를 응답(`editor.saved{ok:false}`) | {@link EditorCommandFailedError} | **진짜 실패** — 재시도/사용자 통지 대상 |
 */

import { StorigeError } from '../errors';
import type { HostCommand } from './protocol';

/**
 * 응답 이벤트 타임아웃 = **미지원 판정**(실패 아님).
 *
 * `editor.ready` 를 관측한 뒤 명령을 보냈는데도 응답이 없을 때만 던진다.
 *
 * @example
 * try {
 *   const state = await editor.getState();
 * } catch (err) {
 *   if (isEditorCommandUnsupported(err)) {
 *     // 구버전 편집기 — 상태 폴링 기능만 비활성화하고 계속 진행
 *   } else {
 *     throw err;
 *   }
 * }
 */
export class EditorCommandUnsupportedError extends StorigeError {
  readonly command: HostCommand;
  readonly timeoutMs: number;

  constructor(command: HostCommand, timeoutMs: number) {
    super(
      `편집기가 '${command}' 명령에 ${timeoutMs}ms 안에 응답하지 않았습니다 — ` +
        '계약상 미지원 command 는 조용히 무시(no-op)되므로 이는 **미지원 판정**이며 실패가 아닙니다.',
    );
    this.command = command;
    this.timeoutMs = timeoutMs;
  }
}

/** 타임아웃이 미지원 판정인지 식별(다른 실패와 구분해 분기하기 위한 가드) */
export function isEditorCommandUnsupported(
  err: unknown,
): err is EditorCommandUnsupportedError {
  return err instanceof EditorCommandUnsupportedError;
}

/**
 * `editor.ready` 를 기다리다 타임아웃 — **미지원 판정이 아니다**.
 *
 * 명령을 보내기도 전이므로 "편집기가 그 명령을 모른다"는 결론을 내릴 수 없다.
 * 대개 잘못된 `token`/`templateSetId`(→ `editor.error`) 이거나 로딩 지연이다.
 */
export class EditorNotReadyError extends StorigeError {
  readonly command: HostCommand | null;
  readonly timeoutMs: number;

  constructor(command: HostCommand | null, timeoutMs: number) {
    super(
      `편집기가 ${timeoutMs}ms 안에 editor.ready 를 보내지 않았습니다` +
        (command ? ` ('${command}' 발신 대기 중)` : '') +
        ' — 미지원 판정이 아니라 미준비 상태입니다(editor.error 수신 여부를 확인하십시오).',
    );
    this.command = command;
    this.timeoutMs = timeoutMs;
  }
}

/** 편집기가 명시적으로 실패를 응답한 경우(`editor.saved{ok:false, error}`) — 진짜 실패 */
export class EditorCommandFailedError extends StorigeError {
  readonly command: HostCommand;
  /** 편집기가 보낸 원인 문자열(사람용 — 분기 키로 쓰지 말 것) */
  readonly reason: string | null;

  constructor(command: HostCommand, reason: string | null) {
    super(
      `편집기가 '${command}' 명령을 실패로 응답했습니다${reason ? `: ${reason}` : ''}`,
    );
    this.command = command;
    this.reason = reason;
  }
}

/** `destroy()` 등으로 핸들이 닫혀 대기 중이던 명령이 취소된 경우 */
export class EditorDetachedError extends StorigeError {
  constructor(message = '편집기 핸들이 이미 해제(destroy)되었습니다') {
    super(message);
  }
}
