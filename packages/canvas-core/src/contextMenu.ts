//import '@/styles/contextMenu.css';
import ContextMenuItem from './models/ContextMenuItem'

/**
 * C6: 터치 롱프레스로 메뉴가 뜬 직후, 손을 떼는 순간 브라우저가 합성하는 mousedown 이
 * onClick(문서 클릭 히든)을 때려 메뉴가 즉시 닫히는 것을 막는 억제 창(ms).
 */
const TOUCH_HIDE_SUPPRESS_MS = 400
/**
 * C6: Android Chrome 은 롱프레스에 네이티브 contextmenu DOM 이벤트를 발화한다. 터치
 * 트리거가 이미 메뉴를 연 직후 이 이벤트가 메뉴를 재발화(이중)하는 것을 무시하는 창(ms).
 */
const TOUCH_NATIVE_CTX_SUPPRESS_MS = 700

class ContextMenu {
  container: HTMLElement
  readonly canvas: fabric.Canvas
  readonly menus: ContextMenuItem[]
  dom: HTMLDivElement | null = null
  parent: ContextMenu | null = null
  submenus: ContextMenu[] = []

  // flags
  shown: boolean = false
  // C6: 터치 트리거 발화 시각 기준 억제 창(0 = 비활성, Date.now() 비교)
  private suppressHideUntil: number = 0
  private suppressNativeContextmenuUntil: number = 0

  constructor(canvas: fabric.Canvas, items: ContextMenuItem[] = []) {
    this.canvas = canvas
    this.container = canvas.wrapperEl
    this.menus = items

    this.addListeners()
  }

  hideAll() {
    if (this.dom && !this.parent) {
      if (this.shown) {
        this.hideSubMenus()

        this.shown = false
        const prev = document.getElementById('context-menu')
        if (prev && this.container.contains(prev)) {
          this.container.removeChild(prev)
        }
      }
      return
    }

    this.parent?.hide()
  }

  hide() {
    if (this.dom && this.shown) {
      this.shown = false
      this.hideSubMenus()

      const prev = document.getElementById('context-menu')
      if (prev && this.container.contains(prev)) {
        this.container.removeChild(prev)
      }

      if (this.parent && this.parent.shown) {
        this.parent.hide()
      }
    }
  }

  hideSubMenus() {
    for (const menu of this.submenus) {
      if (menu.shown) {
        menu.shown = false
        if (menu.dom && menu.container.contains(menu.dom)) {
          menu.container.removeChild(menu.dom)
        }
      }
      menu.hideSubMenus()
    }
  }

  addMenu(data: ContextMenuItem) {
    this.menus.push(data)
  }

  setMenus() {
    const hasActiveObject =
      this.canvas.getActiveObject() !== null && this.canvas.getActiveObject() !== undefined
    const available = this.menus.filter(
      (menu) =>
        (menu.hideContext instanceof Function ? !menu.hideContext() : !menu.hideContext) &&
        (menu.onlyForActiveObject ? hasActiveObject : true)
    )
    if (available.length === 0) {
      // 선재결함(C6 T-6 전제): available 0 인데 직전 성공 표시의 stale this.dom 이 남아
      // 있으면 show() 의 `if(!this.dom) return` 가드를 통과해 빈 곳에도 옛 메뉴가 재-append
      // 된다. dom 을 명시적으로 비워 show() 가 no-op 되게 한다(우클릭·터치 공통 수정).
      this.dom = null
      console.log('no available context menu')
      return
    }

    this.dom = this.getContextMenuDom(available)
  }

  addListeners() {
    this.container.addEventListener('contextmenu', this.onContextmenu)
    this.container.addEventListener('keydown', this.onContextmenuByHotkey)
    this.container.addEventListener('mousedown', this.onClick)
    this.container.addEventListener('blur', this.onBlur)
  }

  dispose() {
    this.dom = null
    this.container.removeEventListener('contextmenu', this.onContextmenu)
    this.container.removeEventListener('keydown', this.onContextmenuByHotkey)
    this.container.removeEventListener('mousedown', this.onClick)
    this.container.removeEventListener('blur', this.onBlur)
  }

  private show(x: number, y: number) {
    this.setMenus()

    // dom이 없으면 (available 메뉴가 없는 경우) 종료
    if (!this.dom) return

    this.dom.style.left = `${x}px`
    this.dom.style.top = `${y}px`

    this.shown = true
    this.container.appendChild(this.dom)

    // 뷰포트 밖 오버플로 클램프(.context position:fixed → 뷰포트 기준). 모바일 가장자리
    // 롱프레스에서 메뉴가 화면 밖으로 잘려 항목을 탭 못 하던 문제 + 데스크탑 우클릭 공통 개선.
    // 레이아웃 미측정 환경(jsdom offsetWidth=0)은 클램프 건너뜀.
    if (typeof window !== 'undefined') {
      const w = this.dom.offsetWidth
      const h = this.dom.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight
      let cx = x
      let cy = y
      if (w > 0 && cx + w > vw) cx = Math.max(0, vw - w - 4)
      if (h > 0 && cy + h > vh) cy = Math.max(0, vh - h - 4)
      if (cx !== x) this.dom.style.left = `${cx}px`
      if (cy !== y) this.dom.style.top = `${cy}px`
    }
  }

  /**
   * C6: 좌표를 지정해 컨텍스트 메뉴를 여는 공개 진입점(터치 롱프레스 트리거용).
   * 우클릭 경로(onContextmenu)와 동일하게 hideAll 후 show 하며(.context 는 position:fixed
   * 라 x/y 는 뷰포트 좌표 = e.clientX/Y 와 동형), touch=true 면 손 떼는 합성 mousedown(T-5)·
   * Android 네이티브 contextmenu 이중발화(T-3)를 무시하는 억제 창을 연다. available 메뉴가
   * 없으면 show 가 자연히 미표시(빈 곳 롱프레스 = 무동작).
   */
  showAt(x: number, y: number, opts?: { touch?: boolean }): boolean {
    this.hideAll()
    this.show(x, y)
    // 억제창은 **메뉴가 실제로 표시된 경우에만** arm 한다 — 빈 곳 롱프레스(미표시) 후
    // 우클릭(button 2)이 억제 가드에 삼켜지는 것 방지(적대 리뷰). T-3(네이티브 contextmenu)·
    // T-5(합성 mousedown) 억제창을 발화(표시) 시각 기준으로 연다.
    if (opts?.touch && this.shown) {
      const now = Date.now()
      this.suppressHideUntil = now + TOUCH_HIDE_SUPPRESS_MS
      this.suppressNativeContextmenuUntil = now + TOUCH_NATIVE_CTX_SUPPRESS_MS
    }
    // 실제 메뉴가 표시됐는지 반환(빈 곳=available 0 이면 show 가 no-op → false).
    // 호출측(터치 트리거)은 이 값이 true 일 때만 haptic 을 울린다(빈 곳 헛진동 방지).
    return this.shown
  }

  /**
   * C6 (T-5 보강): 터치 손 뗌(release) 시점에 히든 억제창을 재-arm 한다. 합성 mousedown 은
   * touchend 이후에 도착하므로, 표시 시각 기준 창(showAt)만으로는 오래 눌렀다 떼는 경우 창이
   * 만료돼 손 떼는 즉시 메뉴가 닫힌다. 트리거가 pointerup 에서 (메뉴가 열려 있을 때만) 호출.
   */
  armTouchHideSuppress(): void {
    if (this.shown) this.suppressHideUntil = Date.now() + TOUCH_HIDE_SUPPRESS_MS
  }

  /// 이벤트 관련 메소드
  private onClick = (e: MouseEvent) => {
    if (!e.target) return

    // C6 (T-5): 롱프레스 발화 직후 손 떼는 순간의 합성 mousedown 이 메뉴를 즉시 닫는 것 억제
    if (Date.now() < this.suppressHideUntil) return

    const target = e.target as HTMLElement
    // 클릭한 대상이 메뉴가 아니면 숨김
    if (
      target != this.dom &&
      target.parentElement != this.dom &&
      !target.classList.contains('item') &&
      !target.parentElement?.classList.contains('item')
    ) {
      this.hideAll()

      if (e.button === 2) {
        this.show(e.clientX, e.clientY)
      }
    }
  }

  private onContextmenu = (e: MouseEvent) => {
    if (!this.dom || !e.target) return

    // C6 (T-3): 터치 트리거가 이미 연 직후의 Android 네이티브 contextmenu 이중발화 무시
    if (Date.now() < this.suppressNativeContextmenuUntil) return

    const target = e.target as HTMLElement

    if (
      target != this.dom &&
      target.parentElement != this.dom &&
      !target.classList.contains('item') &&
      !target.parentElement?.classList.contains('item')
    ) {
      this.hideAll()
      this.show(e.clientX, e.clientY)
    }
  }

  private onContextmenuByHotkey = (e: KeyboardEvent) => {
    if (e.key !== 'ContextMenu') return

    this.hideAll()
    /// 중앙에 표시
    const clientX = window.innerWidth / 2
    const clientY = window.innerHeight / 2
    this.show(clientX, clientY)
  }

  private onBlur = () => {
    console.log('hide all')
    this.hideAll()
  }

  private getContextMenuDom(menus: ContextMenuItem[]): HTMLDivElement {
    const prev = document.getElementById('context-menu')
    if (prev && this.container.contains(prev)) {
      this.container.removeChild(prev)
    }

    const wrapper = document.createElement('div')
    wrapper.classList.add('context')
    wrapper.id = 'context-menu'

    for (const menu of menus) {
      wrapper.appendChild(this.getContextItemDom(menu))
    }

    return wrapper
  }

  private getContextItemDom(data: ContextMenuItem | null) {
    const item = document.createElement('div')

    if (data === null) {
      item.classList.add('separator')
      return item
    } else {
      item.classList.add('item')
    }

    const label = document.createElement('span')
    label.classList.add('label')
    label.innerText = data.name?.toString() ?? ''
    item.appendChild(label)

    if (data.color) {
      item.style.cssText = `color: ${data.color}`
    }

    if (data.disabled === true) {
      item.classList.add('disabled')
    }

    const hotkey = document.createElement('span')
    hotkey.classList.add('hotkey')
    hotkey.innerText = data.input.toString()
    item.appendChild(hotkey)

    // 하위 메뉴가 있을경우
    if (data.children && data.children!.length > 0) {
      const menu = new ContextMenu(this.canvas, data.children ?? [])
      menu.parent = this

      const openContext = () => {
        if (this.dom === null) return
        if (data.disabled === true) return

        this.hideSubMenus()

        const x = this.dom.offsetLeft + this.dom.clientWidth + item.offsetLeft
        const y = this.dom.offsetTop + item.offsetTop

        if (!menu.shown) {
          menu.show(x, y)
        } else {
          menu.hide()
        }
      }

      this.submenus.push(menu)

      item.classList.add('has-submenu')
      item.addEventListener('click', openContext)
      item.addEventListener('mousemove', openContext)
    } else {
      item.addEventListener('click', () => {
        this.hideSubMenus()

        if (item.classList.contains('disabled')) return

        // call onClick
        data.callback()

        this.hideAll()
      })

      item.addEventListener('mousemove', () => {
        this.hideSubMenus()
      })
    }

    return item
  }
}

export default ContextMenu
