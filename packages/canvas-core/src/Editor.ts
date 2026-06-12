import { EventEmitter } from 'events'
import hotkeys from 'hotkeys-js'
import { AsyncSeriesHook } from 'tapable'
import { fabric } from 'fabric'
import { Lifecycle, PluginBase } from './plugin'
import CanvasHotkey from './models/CanvasHotkey'
import ContextMenuItem from './models/ContextMenuItem'
import ContextMenu from './contextMenu'
import { isArray } from 'lodash-es'

class Editor extends EventEmitter {
  [key: string]: any

  public hooks: Map<keyof Lifecycle, AsyncSeriesHook<any, any>> = new Map()

  private contextMenu: ContextMenu | undefined

  private plugins: Map<string, PluginBase> = new Map()

  private canvas: fabric.Canvas | null = null
  private hooksInitialized: boolean = false

  // bindingHotkeys 가 등록한 (input, handler) 쌍 — dispose 시 hotkeys.unbind 용.
  // hotkeys-js 는 전역 싱글톤이라 unbind 하지 않으면 에디터 인스턴스가 사라져도
  // 핸들러가 잔존(메모리 누수 + dispose 된 캔버스 콜백 호출 위험).
  private hotkeyBindings: Array<{ input: string; handler: (keyboardEvent: KeyboardEvent) => void }> = []

  constructor() {
    super()
    // 이벤트 이미터의 최대 리스너 수 증가
    this.setMaxListeners(30)
  }

  get customLifeCycles(): (keyof Lifecycle)[] {
    return ['mounted', 'destroyed', 'beforeLoad', 'afterLoad', 'beforeSave', 'afterSave']
  }

  getPlugin<T extends PluginBase>(pluginName: string): T | undefined {
    if (this.plugins.has(pluginName)) {
      return this.plugins.get(pluginName) as T
    } else {
      return undefined
    }
  }

  init(canvas: fabric.Canvas) {
    this.canvas = canvas
    this.initContextMenu(canvas)
    this.initActionHooks()

    this.once('ready', () => {})
  }

  use(plugin: PluginBase): void {
    if (!this.plugins.has(plugin.name) && this.canvas) {
      this.plugins.set(plugin.name, plugin)

      this.bindingHooks(plugin)
      this.bindingHotkeys(plugin)
      this.bindingContextItems(plugin)

      console.debug('plugin setup', plugin.name)

      // noinspection JSIgnoredPromiseFromCall
      plugin.mounted()
    }
  }

  dispose() {
    for (const plugin of this.plugins.values()) {
      // 플러그인 정리 규약이 두 갈래로 공존한다:
      //  - dispose():   동기 정리 메서드 (13개 플러그인 — Dragging/Controls/Ruler 등)
      //  - destroyed(): Lifecycle 인터페이스 정리 훅 (5개 플러그인 — History/Workspace/
      //                 Spread/Lock/Accessory)
      // 기존에는 dispose() 만 호출해 destroyed() 만 구현한 5개 플러그인의 리스너가
      // 누수됐다. 두 규약 모두 호출해 어느 쪽으로 구현했든 정리되도록 한다.
      // (둘 다 구현한 플러그인은 없음 — 각 구현은 null 가드로 멱등)
      try {
        plugin.dispose && plugin.dispose()
      } catch (e) {
        console.warn(`plugin dispose error (${plugin.name}):`, e)
      }
      try {
        plugin.destroyed && plugin.destroyed()
      } catch (e) {
        console.warn(`plugin destroyed error (${plugin.name}):`, e)
      }
    }

    // 전역 hotkeys-js 핸들러 해제 — 멀티페이지에서 다른 에디터 인스턴스의 단축키와
    // 같은 input 을 공유하므로 (input, handler) 쌍으로 정확히 자기 것만 unbind.
    for (const { input, handler } of this.hotkeyBindings) {
      try {
        hotkeys.unbind(input, handler)
      } catch (e) {
        console.warn(`hotkeys unbind error (${input}):`, e)
      }
    }
    this.hotkeyBindings = []

    // 컨텍스트 메뉴 DOM 리스너 해제 (canvas.wrapperEl 에 등록된 contextmenu/keydown/
    // mousedown/blur — 해제하지 않으면 wrapperEl 이 GC 되지 못함)
    this.contextMenu?.dispose()
    this.contextMenu = undefined

    this.canvas = null
    this.plugins.clear()
    this.hooks.clear()

    // 모든 이벤트 리스너 제거
    this.removeAllListeners()
  }

  private bindingHooks(plugin: PluginBase) {
    this.customLifeCycles.forEach((hookName) => {
      const hook = plugin[hookName]

      if (hook) {
        this.hooks.get(hookName)?.tapPromise(plugin.name + hookName, (...args) => {
          return hook.apply(plugin, args) as Promise<any>
        })
      }
    })
  }

  private bindingHotkeys(plugin: PluginBase) {
    plugin?.hotkeys?.forEach((hotkey: CanvasHotkey) => {
      const inputArray = Array.isArray(hotkey.input) ? hotkey.input : [hotkey.input]
      inputArray.forEach((input) => {
        const handler = (e: KeyboardEvent) => {
          if (e.type === 'keydown') {
            if (hotkey.onlyForActiveObject) {
              const activeObject = this.canvas?.getActiveObject()
              if (!activeObject) return
            }

            // Prevent default browser behavior for hotkeys
            e.preventDefault()
            hotkey.callback()
          }
        }
        // dispose 시 unbind 할 수 있도록 (input, handler) 쌍 보관
        this.hotkeyBindings.push({ input, handler })
        hotkeys(input, { keyup: true }, handler)
      })
    })
  }

  private bindingContextItems(plugin: PluginBase) {
    plugin.hotkeys?.forEach((item: CanvasHotkey) => {
      const menu: ContextMenuItem = {
        ...item,
        input: isArray(item.input) ? item.input[0] : item.input
      }
      this.contextMenu?.addMenu(menu)
    })
  }

  private initContextMenu(canvas: fabric.Canvas) {
    this.contextMenu = new ContextMenu(canvas, [])
  }

  private initActionHooks() {
    // 이미 초기화되었는지 확인
    if (this.hooksInitialized) return
    this.customLifeCycles.forEach((hookName) => {
      this.hooks.set(hookName, new AsyncSeriesHook(['arg']))
    })

    this.hooksInitialized = true
  }
}

export default Editor
