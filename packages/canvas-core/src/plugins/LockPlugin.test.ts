import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * LockPlugin 핵심 로직 테스트
 * - 권한 기반 잠금/해제 로직
 * - CAN_UNLOCK_MAP 권한 매핑
 * - LockInfo 메타데이터 관리
 */

// 권한 레벨 정의
type LockLevel = 'user' | 'designer' | 'admin' | 'system'
type UserRole = 'user' | 'designer' | 'admin'

interface LockInfo {
  isLocked: boolean
  lockLevel: LockLevel
  lockedBy?: string
  lockedAt?: Date
  reason?: string
}

// 권한 레벨별 해제 가능 여부 매핑 (LockPlugin에서 추출)
const CAN_UNLOCK_MAP: Record<UserRole, LockLevel[]> = {
  user: ['user'],
  designer: ['user', 'designer'],
  admin: ['user', 'designer', 'admin']
}

// 잠금 속성 목록
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
 * 해당 역할이 특정 잠금 레벨을 해제할 수 있는지 확인
 */
function canUnlock(userRole: UserRole, lockLevel: LockLevel): boolean {
  if (lockLevel === 'system') return false
  return CAN_UNLOCK_MAP[userRole].includes(lockLevel)
}

/**
 * 객체에서 잠금 정보 추출
 */
function getLockInfo(obj: any): LockInfo {
  const lockInfo = obj.lockInfo as LockInfo | undefined

  if (lockInfo) {
    return lockInfo
  }

  // L1① (2026-07-06): 위치고정(movable===false)은 잠금이 아님 — 실물과 동기.
  if (obj.movable === false) {
    return { isLocked: false, lockLevel: 'user' }
  }

  // 레거시 방식의 잠금 확인
  const isLegacyLocked = LOCK_ATTRIBUTES.some(attr => obj[attr] === true)

  return {
    isLocked: isLegacyLocked,
    lockLevel: isLegacyLocked ? 'user' : 'user'
  }
}

/**
 * 객체 잠금 적용
 */
function applyLock(obj: any, level: LockLevel, userRole: UserRole, reason?: string): boolean {
  const currentLockInfo = getLockInfo(obj)

  // 이미 더 높은 레벨로 잠겨있는지 확인
  if (currentLockInfo.isLocked && !canUnlock(userRole, currentLockInfo.lockLevel)) {
    return false
  }

  // 잠금 속성 설정
  LOCK_ATTRIBUTES.forEach(attr => {
    obj[attr] = true
  })

  // 추가 잠금 속성
  obj.selectable = false
  obj.evented = false
  obj.hasControls = false
  obj.hasBorders = false
  obj.hoverCursor = 'not-allowed'

  // 잠금 메타데이터 저장
  obj.lockInfo = {
    isLocked: true,
    lockLevel: level,
    lockedBy: userRole,
    lockedAt: new Date(),
    reason
  } as LockInfo

  return true
}

/**
 * 객체 잠금 해제
 */
function applyUnlock(obj: any, userRole: UserRole, force = false): boolean {
  const lockInfo = getLockInfo(obj)

  if (!lockInfo.isLocked) {
    return true
  }

  // 시스템 잠금은 해제 불가
  if (lockInfo.lockLevel === 'system' && !force) {
    return false
  }

  // 권한 확인
  if (!force && !canUnlock(userRole, lockInfo.lockLevel)) {
    return false
  }

  // 잠금 속성 해제
  LOCK_ATTRIBUTES.forEach(attr => {
    obj[attr] = false
  })

  // 추가 속성 복원
  obj.selectable = true
  obj.evented = true
  obj.hasControls = true
  obj.hasBorders = true
  obj.hoverCursor = 'move'

  // 잠금 메타데이터 제거
  obj.lockInfo = {
    isLocked: false,
    lockLevel: 'user'
  } as LockInfo

  return true
}

describe('LockPlugin - Permission System', () => {
  describe('CAN_UNLOCK_MAP permissions', () => {
    it('user can only unlock user-level locks', () => {
      expect(canUnlock('user', 'user')).toBe(true)
      expect(canUnlock('user', 'designer')).toBe(false)
      expect(canUnlock('user', 'admin')).toBe(false)
      expect(canUnlock('user', 'system')).toBe(false)
    })

    it('designer can unlock user and designer level locks', () => {
      expect(canUnlock('designer', 'user')).toBe(true)
      expect(canUnlock('designer', 'designer')).toBe(true)
      expect(canUnlock('designer', 'admin')).toBe(false)
      expect(canUnlock('designer', 'system')).toBe(false)
    })

    it('admin can unlock user, designer, and admin level locks', () => {
      expect(canUnlock('admin', 'user')).toBe(true)
      expect(canUnlock('admin', 'designer')).toBe(true)
      expect(canUnlock('admin', 'admin')).toBe(true)
      expect(canUnlock('admin', 'system')).toBe(false)
    })

    it('no one can unlock system locks', () => {
      expect(canUnlock('user', 'system')).toBe(false)
      expect(canUnlock('designer', 'system')).toBe(false)
      expect(canUnlock('admin', 'system')).toBe(false)
    })
  })

  describe('getLockInfo', () => {
    it('should return lockInfo if present', () => {
      const obj = {
        lockInfo: {
          isLocked: true,
          lockLevel: 'designer' as LockLevel,
          lockedBy: 'designer',
          reason: 'Template lock'
        }
      }

      const info = getLockInfo(obj)
      expect(info.isLocked).toBe(true)
      expect(info.lockLevel).toBe('designer')
      expect(info.reason).toBe('Template lock')
    })

    it('should detect legacy lock from lock attributes', () => {
      const obj = {
        lockMovementX: true,
        lockMovementY: false
      }

      const info = getLockInfo(obj)
      expect(info.isLocked).toBe(true)
      expect(info.lockLevel).toBe('user')
    })

    it('should return unlocked for objects without lock', () => {
      const obj = {}

      const info = getLockInfo(obj)
      expect(info.isLocked).toBe(false)
    })
  })

  describe('applyLock', () => {
    let mockObject: any

    beforeEach(() => {
      mockObject = {
        id: 'test-object'
      }
    })

    it('should apply user lock successfully', () => {
      const result = applyLock(mockObject, 'user', 'user')

      expect(result).toBe(true)
      expect(mockObject.lockMovementX).toBe(true)
      expect(mockObject.lockMovementY).toBe(true)
      expect(mockObject.lockRotation).toBe(true)
      expect(mockObject.selectable).toBe(false)
      expect(mockObject.evented).toBe(false)
      expect(mockObject.lockInfo.isLocked).toBe(true)
      expect(mockObject.lockInfo.lockLevel).toBe('user')
    })

    it('should apply designer lock', () => {
      const result = applyLock(mockObject, 'designer', 'designer', 'Template protection')

      expect(result).toBe(true)
      expect(mockObject.lockInfo.lockLevel).toBe('designer')
      expect(mockObject.lockInfo.reason).toBe('Template protection')
    })

    it('should apply admin lock', () => {
      const result = applyLock(mockObject, 'admin', 'admin')

      expect(result).toBe(true)
      expect(mockObject.lockInfo.lockLevel).toBe('admin')
    })

    it('should apply system lock', () => {
      const result = applyLock(mockObject, 'system', 'admin')

      expect(result).toBe(true)
      expect(mockObject.lockInfo.lockLevel).toBe('system')
    })

    it('should fail to override higher level lock with lower permission', () => {
      // First apply admin lock
      applyLock(mockObject, 'admin', 'admin')

      // Try to override with user role
      const result = applyLock(mockObject, 'user', 'user')

      expect(result).toBe(false)
      expect(mockObject.lockInfo.lockLevel).toBe('admin') // Still admin
    })

    it('should allow admin to override lower level locks', () => {
      // First apply user lock
      applyLock(mockObject, 'user', 'user')

      // Admin overrides
      const result = applyLock(mockObject, 'admin', 'admin')

      expect(result).toBe(true)
      expect(mockObject.lockInfo.lockLevel).toBe('admin')
    })
  })

  describe('applyUnlock', () => {
    let mockObject: any

    beforeEach(() => {
      mockObject = {
        id: 'test-object'
      }
    })

    it('should unlock user lock as user', () => {
      applyLock(mockObject, 'user', 'user')
      const result = applyUnlock(mockObject, 'user')

      expect(result).toBe(true)
      expect(mockObject.lockMovementX).toBe(false)
      expect(mockObject.selectable).toBe(true)
      expect(mockObject.lockInfo.isLocked).toBe(false)
    })

    it('should return true for already unlocked object', () => {
      const result = applyUnlock(mockObject, 'user')
      expect(result).toBe(true)
    })

    it('should fail to unlock designer lock as user', () => {
      applyLock(mockObject, 'designer', 'designer')
      const result = applyUnlock(mockObject, 'user')

      expect(result).toBe(false)
      expect(mockObject.lockInfo.isLocked).toBe(true)
    })

    it('should unlock designer lock as designer', () => {
      applyLock(mockObject, 'designer', 'designer')
      const result = applyUnlock(mockObject, 'designer')

      expect(result).toBe(true)
      expect(mockObject.lockInfo.isLocked).toBe(false)
    })

    it('should unlock admin lock as admin', () => {
      applyLock(mockObject, 'admin', 'admin')
      const result = applyUnlock(mockObject, 'admin')

      expect(result).toBe(true)
      expect(mockObject.lockInfo.isLocked).toBe(false)
    })

    it('should fail to unlock system lock', () => {
      applyLock(mockObject, 'system', 'admin')
      const result = applyUnlock(mockObject, 'admin')

      expect(result).toBe(false)
      expect(mockObject.lockInfo.isLocked).toBe(true)
    })

    it('should force unlock system lock when force=true', () => {
      applyLock(mockObject, 'system', 'admin')
      const result = applyUnlock(mockObject, 'admin', true)

      expect(result).toBe(true)
      expect(mockObject.lockInfo.isLocked).toBe(false)
    })

    it('should force unlock any lock regardless of permission', () => {
      applyLock(mockObject, 'admin', 'admin')
      const result = applyUnlock(mockObject, 'user', true)

      expect(result).toBe(true)
      expect(mockObject.lockInfo.isLocked).toBe(false)
    })
  })

  describe('Toggle Lock', () => {
    it('should toggle between locked and unlocked states', () => {
      const obj: any = { id: 'test' }

      // Lock
      applyLock(obj, 'user', 'user')
      expect(getLockInfo(obj).isLocked).toBe(true)

      // Unlock
      applyUnlock(obj, 'user')
      expect(getLockInfo(obj).isLocked).toBe(false)

      // Lock again
      applyLock(obj, 'user', 'user')
      expect(getLockInfo(obj).isLocked).toBe(true)
    })
  })

  describe('Lock Metadata', () => {
    it('should store lock metadata correctly', () => {
      const obj: any = { id: 'test' }
      const beforeLock = new Date()

      applyLock(obj, 'designer', 'designer', 'For review')

      expect(obj.lockInfo.lockedBy).toBe('designer')
      expect(obj.lockInfo.reason).toBe('For review')
      expect(obj.lockInfo.lockedAt).toBeInstanceOf(Date)
      expect(obj.lockInfo.lockedAt.getTime()).toBeGreaterThanOrEqual(beforeLock.getTime())
    })

    it('should clear metadata on unlock', () => {
      const obj: any = { id: 'test' }

      applyLock(obj, 'user', 'user', 'Test reason')
      applyUnlock(obj, 'user')

      expect(obj.lockInfo.isLocked).toBe(false)
      expect(obj.lockInfo.reason).toBeUndefined()
    })
  })

  describe('Lock Attributes', () => {
    it('should set all lock attributes on lock', () => {
      const obj: any = { id: 'test' }
      applyLock(obj, 'user', 'user')

      LOCK_ATTRIBUTES.forEach(attr => {
        expect(obj[attr]).toBe(true)
      })
    })

    it('should clear all lock attributes on unlock', () => {
      const obj: any = { id: 'test' }
      applyLock(obj, 'user', 'user')
      applyUnlock(obj, 'user')

      LOCK_ATTRIBUTES.forEach(attr => {
        expect(obj[attr]).toBe(false)
      })
    })

    it('should set correct UI properties on lock', () => {
      const obj: any = { id: 'test' }
      applyLock(obj, 'user', 'user')

      expect(obj.selectable).toBe(false)
      expect(obj.evented).toBe(false)
      expect(obj.hasControls).toBe(false)
      expect(obj.hasBorders).toBe(false)
      expect(obj.hoverCursor).toBe('not-allowed')
    })

    it('should restore UI properties on unlock', () => {
      const obj: any = { id: 'test' }
      applyLock(obj, 'user', 'user')
      applyUnlock(obj, 'user')

      expect(obj.selectable).toBe(true)
      expect(obj.evented).toBe(true)
      expect(obj.hasControls).toBe(true)
      expect(obj.hasBorders).toBe(true)
      expect(obj.hoverCursor).toBe('move')
    })
  })

  describe('Hierarchy Permission Levels', () => {
    const roles: UserRole[] = ['user', 'designer', 'admin']
    const levels: LockLevel[] = ['user', 'designer', 'admin', 'system']

    it('should follow strict hierarchy: user < designer < admin < system', () => {
      // user: can only unlock user
      expect(CAN_UNLOCK_MAP.user).toEqual(['user'])

      // designer: can unlock user + designer
      expect(CAN_UNLOCK_MAP.designer).toEqual(['user', 'designer'])

      // admin: can unlock user + designer + admin
      expect(CAN_UNLOCK_MAP.admin).toEqual(['user', 'designer', 'admin'])
    })

    it('should not have any role able to unlock higher level', () => {
      roles.forEach(role => {
        const roleIndex = roles.indexOf(role)
        const higherLevels = levels.slice(roleIndex + 1)

        higherLevels.forEach(level => {
          expect(canUnlock(role, level)).toBe(false)
        })
      })
    })
  })

  describe('Batch Operations', () => {
    it('should lock multiple objects', () => {
      const objects = [
        { id: 'obj1' },
        { id: 'obj2' },
        { id: 'obj3' }
      ]

      let successCount = 0
      objects.forEach(obj => {
        if (applyLock(obj, 'user', 'user')) {
          successCount++
        }
      })

      expect(successCount).toBe(3)
      objects.forEach(obj => {
        expect(getLockInfo(obj).isLocked).toBe(true)
      })
    })

    it('should unlock multiple objects', () => {
      const objects = [
        { id: 'obj1' },
        { id: 'obj2' },
        { id: 'obj3' }
      ]

      objects.forEach(obj => applyLock(obj, 'user', 'user'))

      let successCount = 0
      objects.forEach(obj => {
        if (applyUnlock(obj, 'user')) {
          successCount++
        }
      })

      expect(successCount).toBe(3)
      objects.forEach(obj => {
        expect(getLockInfo(obj).isLocked).toBe(false)
      })
    })

    it('should count locks by permission when unlocking with insufficient permission', () => {
      const objects = [
        { id: 'obj1' },
        { id: 'obj2' },
        { id: 'obj3' }
      ]

      // Lock with different levels
      applyLock(objects[0], 'user', 'user')
      applyLock(objects[1], 'designer', 'designer')
      applyLock(objects[2], 'admin', 'admin')

      // User tries to unlock all
      let successCount = 0
      objects.forEach(obj => {
        if (applyUnlock(obj, 'user')) {
          successCount++
        }
      })

      expect(successCount).toBe(1) // Only user lock unlocked
      expect(getLockInfo(objects[0]).isLocked).toBe(false)
      expect(getLockInfo(objects[1]).isLocked).toBe(true)
      expect(getLockInfo(objects[2]).isLocked).toBe(true)
    })
  })
})

// ────────────────────────────────────────────────────────────────────────────
// L1① (2026-07-06) 실물 회귀 스펙 — 미러가 아니라 실제 LockPlugin.prototype 검증.
// getLockInfo 는 this 를 사용하지 않으므로 인스턴스 없이 프로토타입 호출로 검증한다
// (fabric 캔버스 기동 불필요 — canvas.test.ts 미러 함정의 재발 방지).
// ────────────────────────────────────────────────────────────────────────────
import RealLockPlugin from './LockPlugin'

describe('L1① 실물 getLockInfo — 위치고정(movable=false)은 잠금이 아니다', () => {
  const realGetLockInfo = (obj: unknown) =>
    (RealLockPlugin.prototype.getLockInfo as (o: unknown) => LockInfo).call(null, obj)

  it('movable=false + lockMovementX/Y=true (applyObjectPermissions 산출물) → isLocked=false (선택 유지)', () => {
    const placeholder = {
      movable: false,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      hasControls: false,
    }
    expect(realGetLockInfo(placeholder).isLocked).toBe(false)
  })

  it('movable 미지정 + lockMovementX=true (레거시 단순잠금) → isLocked=true (현행 유지)', () => {
    expect(realGetLockInfo({ lockMovementX: true }).isLocked).toBe(true)
  })

  it('movable=false 여도 lockInfo.isLocked=true (진짜 고급잠금) → isLocked=true (고급잠금 경로 불변)', () => {
    const advanced = {
      movable: false,
      lockInfo: { isLocked: true, lockLevel: 'admin' as const },
    }
    const info = realGetLockInfo(advanced)
    expect(info.isLocked).toBe(true)
    expect(info.lockLevel).toBe('admin')
  })

  it('movable=true 명시 + lock 속성 없음 → isLocked=false', () => {
    expect(realGetLockInfo({ movable: true }).isLocked).toBe(false)
  })
})
