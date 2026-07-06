import { fabric } from 'fabric'
import Editor from '../Editor'
import { PluginBase, PluginOption } from '../plugin'
import CanvasHotkey from '../models/CanvasHotkey'

/**
 * 요소 잠금 권한 레벨
 * - user: 일반 사용자 잠금 (누구나 해제 가능)
 * - designer: 디자이너 잠금 (디자이너/관리자만 해제 가능)
 * - admin: 관리자 잠금 (관리자만 해제 가능)
 * - system: 시스템 잠금 (해제 불가)
 */
export type LockLevel = 'user' | 'designer' | 'admin' | 'system'

/**
 * 사용자 역할
 */
export type UserRole = 'user' | 'designer' | 'admin'

/**
 * 잠금 정보 인터페이스
 */
export interface LockInfo {
  isLocked: boolean
  lockLevel: LockLevel
  lockedBy?: string
  lockedAt?: Date
  reason?: string
}

/**
 * 잠금된 속성 목록
 */
const LOCK_ATTRIBUTES = [
  'lockMovementX',
  'lockMovementY',
  'lockRotation',
  'lockScalingX',
  'lockScalingY',
  'lockSkewingX',
  'lockSkewingY'
] as const

/**
 * 권한 레벨별 해제 가능 여부 매핑
 */
const CAN_UNLOCK_MAP: Record<UserRole, LockLevel[]> = {
  user: ['user'],
  designer: ['user', 'designer'],
  admin: ['user', 'designer', 'admin']
}

/**
 * 요소 잠금/해제 플러그인
 * 권한별 잠금 관리 및 잠금된 요소 편집 차단
 */
class LockPlugin extends PluginBase {
  name = 'LockPlugin'
  events = ['object:locked', 'object:unlocked', 'lock:denied']

  private currentUserRole: UserRole = 'user'
  private boundHandleSelection: ((e: fabric.IEvent) => void) | null = null
  private boundHandleMoving: ((e: fabric.IEvent) => void) | null = null

  constructor(canvas: fabric.Canvas, editor: Editor, options: PluginOption) {
    super(canvas, editor, options)
    this.init()
  }

  get hotkeys(): CanvasHotkey[] {
    return [
      {
        name: '잠금/해제 토글',
        input: 'cmd+l',
        callback: () => this.toggleLock(),
        onlyForActiveObject: true
      }
    ]
  }

  private init() {
    // 선택 이벤트 핸들러
    this.boundHandleSelection = this.handleSelection.bind(this)
    this.boundHandleMoving = this.handleMoving.bind(this)

    this._canvas.on('selection:created', this.boundHandleSelection)
    this._canvas.on('selection:updated', this.boundHandleSelection)
    this._canvas.on('object:moving', this.boundHandleMoving)
  }

  /**
   * 현재 사용자 역할 설정
   */
  setUserRole(role: UserRole) {
    this.currentUserRole = role
    console.log(`🔐 사용자 역할 설정: ${role}`)
  }

  /**
   * 현재 사용자 역할 반환
   */
  getUserRole(): UserRole {
    return this.currentUserRole
  }

  /**
   * 객체 잠금
   * @param obj 대상 객체
   * @param level 잠금 레벨
   * @param reason 잠금 사유 (선택)
   */
  lock(obj: fabric.Object, level: LockLevel = 'user', reason?: string): boolean {
    if (!obj) return false

    // 이미 더 높은 레벨로 잠겨있는지 확인
    const currentLockInfo = this.getLockInfo(obj)
    if (currentLockInfo.isLocked && !this.canUnlock(currentLockInfo.lockLevel)) {
      console.warn('🔒 더 높은 권한의 잠금이 이미 적용되어 있습니다.')
      return false
    }

    this._canvas.offHistory()

    // 잠금 속성 설정
    LOCK_ATTRIBUTES.forEach(attr => {
      (obj as any)[attr] = true
    })

    // 추가 잠금 속성
    obj.set({
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      hoverCursor: 'not-allowed'
    })

    // 잠금 메타데이터 저장
    ;(obj as any).lockInfo = {
      isLocked: true,
      lockLevel: level,
      lockedBy: this.currentUserRole,
      lockedAt: new Date(),
      reason
    } as LockInfo

    obj.setCoords()
    this._canvas.discardActiveObject()
    this._canvas.requestRenderAll()
    this._canvas.onHistory()

    this._editor.emit('object:locked', { object: obj, level, reason })
    console.log(`🔒 객체 잠금: ${obj.id || 'unknown'} (레벨: ${level})`)

    return true
  }

  /**
   * 객체 잠금 해제
   * @param obj 대상 객체
   * @param force 강제 해제 (관리자 전용)
   */
  unlock(obj: fabric.Object, force = false): boolean {
    if (!obj) return false

    const lockInfo = this.getLockInfo(obj)

    if (!lockInfo.isLocked) {
      console.warn('🔓 이미 잠금 해제된 객체입니다.')
      return true
    }

    // 시스템 잠금은 해제 불가
    if (lockInfo.lockLevel === 'system' && !force) {
      console.error('🚫 시스템 잠금은 해제할 수 없습니다.')
      this._editor.emit('lock:denied', { object: obj, reason: 'system_lock' })
      return false
    }

    // 권한 확인
    if (!force && !this.canUnlock(lockInfo.lockLevel)) {
      console.warn(`🚫 ${lockInfo.lockLevel} 레벨 잠금을 해제할 권한이 없습니다. (현재: ${this.currentUserRole})`)
      this._editor.emit('lock:denied', { object: obj, reason: 'insufficient_permission' })
      return false
    }

    this._canvas.offHistory()

    // 잠금 속성 해제
    LOCK_ATTRIBUTES.forEach(attr => {
      (obj as any)[attr] = false
    })

    // 추가 속성 복원
    obj.set({
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
      hoverCursor: 'move'
    })

    // 잠금 메타데이터 제거
    ;(obj as any).lockInfo = {
      isLocked: false,
      lockLevel: 'user'
    } as LockInfo

    obj.setCoords()
    this._canvas.requestRenderAll()
    this._canvas.onHistory()

    this._editor.emit('object:unlocked', { object: obj })
    console.log(`🔓 객체 잠금 해제: ${obj.id || 'unknown'}`)

    return true
  }

  /**
   * 잠금 토글
   */
  toggleLock(obj?: fabric.Object, level: LockLevel = 'user'): boolean {
    const target = obj || this._canvas.getActiveObject()
    if (!target) return false

    const lockInfo = this.getLockInfo(target)

    if (lockInfo.isLocked) {
      return this.unlock(target)
    } else {
      return this.lock(target, level)
    }
  }

  /**
   * 객체의 잠금 정보 조회
   */
  getLockInfo(obj: fabric.Object): LockInfo {
    const lockInfo = (obj as any).lockInfo as LockInfo | undefined

    if (lockInfo) {
      return lockInfo
    }

    // L1① (2026-07-06): 위치고정(movable===false, Part B)은 '잠금'이 아니다 —
    // applyObjectPermissions 가 lockMovement* 를 세팅하지만 선택/내용편집은 허용이
    // 설계 규약. 레거시 렌즈가 이를 isLocked 로 오판하면 handleSelection 이 고객
    // 선택을 즉시 해제해 '위치고정=선택불가'로 변질된다(실버그). 이동 차단 자체는
    // fabric lockMovementX/Y 가 담당하므로 여기서 false 를 줘도 드래그는 막힌다.
    // ⚠️ lockInfo(고급잠금) 경로는 위에서 이미 반환 — 절대 불변.
    if ((obj as any).movable === false) {
      return { isLocked: false, lockLevel: 'user' }
    }

    // 레거시 방식의 잠금 확인 (lockMovementX 등)
    const isLegacyLocked = LOCK_ATTRIBUTES.some(attr => (obj as any)[attr] === true)

    return {
      isLocked: isLegacyLocked,
      lockLevel: isLegacyLocked ? 'user' : 'user'
    }
  }

  /**
   * 현재 사용자가 해당 레벨의 잠금을 해제할 수 있는지 확인
   */
  canUnlock(lockLevel: LockLevel): boolean {
    if (lockLevel === 'system') return false
    return CAN_UNLOCK_MAP[this.currentUserRole].includes(lockLevel)
  }

  /**
   * 선택된 객체들의 잠금 상태 확인
   */
  getSelectedLockStatus(): { locked: number; unlocked: number; canUnlock: number } {
    const activeObjects = this._canvas.getActiveObjects()
    let locked = 0
    let unlocked = 0
    let canUnlockCount = 0

    activeObjects.forEach(obj => {
      const lockInfo = this.getLockInfo(obj)
      if (lockInfo.isLocked) {
        locked++
        if (this.canUnlock(lockInfo.lockLevel)) {
          canUnlockCount++
        }
      } else {
        unlocked++
      }
    })

    return { locked, unlocked, canUnlock: canUnlockCount }
  }

  /**
   * 여러 객체 일괄 잠금
   */
  lockMultiple(objects: fabric.Object[], level: LockLevel = 'user', reason?: string): number {
    let successCount = 0
    objects.forEach(obj => {
      if (this.lock(obj, level, reason)) {
        successCount++
      }
    })
    return successCount
  }

  /**
   * 여러 객체 일괄 잠금 해제
   */
  unlockMultiple(objects: fabric.Object[], force = false): number {
    let successCount = 0
    objects.forEach(obj => {
      if (this.unlock(obj, force)) {
        successCount++
      }
    })
    return successCount
  }

  /**
   * 선택 이벤트 핸들러 - 잠긴 객체 선택 차단
   */
  private handleSelection(e: fabric.IEvent) {
    // B1 (2026-07-04): admin(editMode 승격) 은 잠긴 객체의 선택 유지 허용 — 레벨 변경/해제 관리 목적.
    // 주의: lock() 이 selectable/evented=false 를 세팅하므로 캔버스 직접 클릭으로는 여전히 선택
    // 불가 — 이 바이패스는 프로그래매틱 선택(레이어 패널 행 클릭 setActiveObject, ControlBar
    // 레벨 변경 후 선택 복원)을 살리는 용도다. 고객(user/designer) 동작은 불변.
    if (this.currentUserRole === 'admin') return

    const selected = e.selected || []

    // 잠긴 객체가 선택되었는지 확인
    const lockedObjects = selected.filter(obj => this.getLockInfo(obj).isLocked)

    if (lockedObjects.length > 0) {
      // 잠긴 객체는 선택에서 제외
      const unlockedObjects = selected.filter(obj => !this.getLockInfo(obj).isLocked)

      if (unlockedObjects.length > 0) {
        // 잠기지 않은 객체만 선택
        if (unlockedObjects.length === 1) {
          this._canvas.setActiveObject(unlockedObjects[0])
        } else {
          this._canvas.setActiveObject(new fabric.ActiveSelection(unlockedObjects, {
            canvas: this._canvas
          }))
        }
      } else {
        // 모든 객체가 잠겨있으면 선택 해제
        this._canvas.discardActiveObject()
      }

      this._canvas.requestRenderAll()
    }
  }

  /**
   * 이동 이벤트 핸들러 - 잠긴 객체 이동 차단
   */
  private handleMoving(e: fabric.IEvent) {
    const obj = e.target
    if (!obj) return

    const lockInfo = this.getLockInfo(obj)
    if (lockInfo.isLocked) {
      // 원위치로 복원
      obj.setCoords()
      this._canvas.requestRenderAll()
    }
  }

  /**
   * 캔버스의 모든 잠긴 객체 조회
   */
  getAllLockedObjects(): fabric.Object[] {
    return this._canvas.getObjects().filter(obj => this.getLockInfo(obj).isLocked)
  }

  /**
   * 특정 레벨로 잠긴 객체 조회
   */
  getObjectsByLockLevel(level: LockLevel): fabric.Object[] {
    return this._canvas.getObjects().filter(obj => {
      const lockInfo = this.getLockInfo(obj)
      return lockInfo.isLocked && lockInfo.lockLevel === level
    })
  }

  /**
   * 플러그인 정리
   */
  destroyed(): Promise<void> {
    if (this.boundHandleSelection) {
      this._canvas.off('selection:created', this.boundHandleSelection)
      this._canvas.off('selection:updated', this.boundHandleSelection)
      this.boundHandleSelection = null
    }

    if (this.boundHandleMoving) {
      this._canvas.off('object:moving', this.boundHandleMoving)
      this.boundHandleMoving = null
    }

    return Promise.resolve()
  }
}

export default LockPlugin
