import { fabric } from 'fabric'
import Editor from '../Editor'
import { BarCodeType, QrCodeOption, SmartCodeOption } from '../models'
import { v4 as uuid } from 'uuid'
import { blobToBase64 } from '../utils/utils'
import { core } from '../utils/canvas'
import { PluginBase } from '../plugin'

const defaultBarCodeOption = {
  format: BarCodeType.EAN13,
  textAlign: 'center',
  textPosition: 'bottom',
  fontSize: 14,
  background: 'transparent',
  lineColor: '#000',
  displayValue: true
}

const defaultQrCodeOption = {
  width: 200,
  height: 200,
  type: 'canvas',
  margin: 10,
  qrOptions: {
    errorCorrectionLevel: 'M'
  },
  dotsOptions: {
    color: '#000000',
    type: 'rounded'
  },
  cornersSquareOptions: {
    color: '#000000',
    type: 'square'
  },
  cornersDotOptions: {
    color: '#000000',
    type: 'square'
  },
  backgroundOptions: {
    color: '#ffffff'
  }
}

class SmartCodePlugin extends PluginBase {
  name = 'SmartCodePlugin'
  hotkeys = []
  events = []

  constructor(canvas: fabric.Canvas, editor: Editor) {
    super(canvas, editor, {})
  }

  async hookTransform(object: fabric.Object) {
    if (object.extensionType === 'barcode') {
      object.src = await this.getBarCodeDataUrl(object.extension)
    } else if (object.extensionType === 'qrcode') {
      object.src = await this.getQrCodeDataUrl(object.extension)
    }
  }

  public async barcode(option: SmartCodeOption): Promise<fabric.Image | undefined> {
    const lastOptions = { ...defaultBarCodeOption, ...option }
    // ⚠️ getBarCodeDataUrl 은 async(dynamic import). await 를 Promise executor '밖'에서 수행해
    // 예외(잘못된 입력·청크 로드 실패)가 async executor 에 삼켜져 무한 hang 되지 않고 caller 로 전파되게 한다.
    const url = await this.getBarCodeDataUrl(JSON.parse(JSON.stringify(lastOptions)))
    return new Promise((resolve) => {
      fabric.Image.fromURL(
        url,
        (imgEl: fabric.Image) => {
          imgEl.set({
            extensionType: 'barcode',
            extension: lastOptions
          })
          imgEl.scaleToWidth(this._getWorkspace()!.getScaledWidth() / 2)
          core.keepObjectRatio(imgEl)
          resolve(imgEl)
        },
        {
          id: uuid(),
          crossOrigin: 'anonymous',
          originX: 'center',
          originY: 'center'
        }
      )
    })
  }

  public async qrcode(option: QrCodeOption): Promise<fabric.Image | undefined> {
    const lastOptions = { ...defaultQrCodeOption, ...option }
    // ⚠️ getQrCodeDataUrl 은 async(dynamic import). await 를 Promise executor '밖'에서 수행해
    // 예외가 삼켜져 무한 hang 되지 않고 caller 로 전파되게 한다(async executor 안티패턴 제거).
    const url = await this.getQrCodeDataUrl(lastOptions)
    return new Promise((resolve) => {
      fabric.Image.fromURL(
        url,
        (imgEl) => {
          imgEl.set({
            extensionType: 'qrcode',
            extension: lastOptions
          })
          imgEl.scaleToWidth(this._getWorkspace()!.getScaledWidth() / 2)

          core.keepObjectRatio(imgEl)
          resolve(imgEl)
        },
        {
          id: uuid(),
          crossOrigin: 'anonymous',
          originX: 'center',
          originY: 'center'
        }
      )
    })
  }

  private async getBarCodeDataUrl(option: any): Promise<string> {
    const { default: JsBarcode } = await import('jsbarcode')
    const canvas = document.createElement('canvas')
    let value = option.value

    JsBarcode(canvas, value, {
      ...option
    })
    return canvas.toDataURL('image/png', 1)
  }

  private async getQrCodeDataUrl(options: any): Promise<string> {
    const { default: QRCodeStyling } = await import('qr-code-styling')
    const qrCode = new QRCodeStyling(options)
    const blob = await qrCode.getRawData('png')
    if (!blob) return ''
    const base64Str = (await blobToBase64(blob)) as string
    return base64Str || ''
  }
}

export default SmartCodePlugin
