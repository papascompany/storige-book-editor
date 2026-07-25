import Editor from './Editor'
import CanvasHotkey from './models/CanvasHotkey'

export type Exposed<T> = { [K in keyof T]: T[K] }
export type PluginOption = Exposed<Record<string, any>>

export interface ControlsPluginOption extends PluginOption {
  transparentCorners?: boolean
  borderColor?: string
  cornerColor?: string
  borderScaleFactor?: number
  cornerStyle?: 'circle' | 'rect' | undefined
  cornerStrokeColor?: string
  borderOpacityWhenMoving?: number
}

export interface Lifecycle {
  mounted: () => Promise<void>
  destroyed: () => Promise<void>
  beforeLoad: () => Promise<void>
  afterLoad: () => Promise<void>
  beforeSave: () => Promise<void>
  afterSave: () => Promise<void>
}

export abstract class PluginBase implements Lifecycle {
  readonly _canvas: fabric.Canvas
  readonly _editor: Editor
  _options: PluginOption
  abstract name: string
  abstract events: string[]

  // key is KeyInput
  abstract hotkeys: CanvasHotkey[]

  protected constructor(canvas: fabric.Canvas, editor: Editor, options: PluginOption) {
    this._canvas = canvas
    this._editor = editor
    this._options = options
  }

  mounted(): Promise<void> {
    return new Promise((r) => {
      this._editor.emit(`${this.name}:mounted`)
      r()
    })
  }

  destroyed(): Promise<void> {
    return new Promise((r) => r())
  }

  /**
   * 동기 정리 훅 (Editor.dispose 가 `plugin.dispose && plugin.dispose()` 로 호출).
   * PluginBase 는 정리할 인스턴스 리소스가 없으므로 no-op 기본 구현을 둔다.
   * 과거 FilterPlugin.dispose 가 존재하지 않는 super.dispose() 를 호출해 TypeError 를
   * 던졌고(Editor.dispose try/catch 가 console.warn 로 강등), 이 no-op 이 그 함정을
   * 근본 차단한다 — 하위 플러그인이 super.dispose() 를 호출해도 안전하다.
   */
  dispose(): void {}

  beforeLoad(...args: any[]): Promise<void> {
    return new Promise((r) => r(...args))
  }

  afterLoad(...args: any[]): Promise<void> {
    return new Promise((r) => r(...args))
  }

  beforeSave(...args: any[]): Promise<void> {
    return new Promise((r) => r(...args))
  }

  afterSave(...args: any[]): Promise<void> {
    return new Promise((r) => r(...args))
  }

  protected _getWorkspace(): fabric.Object | undefined {
    return this._canvas.getObjects().find((obj: fabric.Object) => obj.id === 'workspace')
  }

  [propName: string]: any
}
