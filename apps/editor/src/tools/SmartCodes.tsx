import { useCallback, useState, useRef } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BarCodeType, SmartCodePlugin } from '@storige/canvas-core'

export default function SmartCodes() {
  const canvas = useAppStore((state) => state.canvas)
  const ready = useAppStore((state) => state.ready)
  const getPlugin = useAppStore((state) => state.getPlugin)

  // QR form state
  const [qrUrl, setQrUrl] = useState('')
  const qrInputRef = useRef<HTMLInputElement>(null)

  // Barcode form state
  const [barcodeType, setBarcodeType] = useState<BarCodeType>(BarCodeType.EAN13)
  const [ean13Value, setEan13Value] = useState('')
  const [ean8Value, setEan8Value] = useState('')

  const barcodeOptions = [
    { label: 'EAN-13', value: BarCodeType.EAN13 },
    { label: 'EAN-8 (단축형)', value: BarCodeType.EAN8 }
  ]

  // Handle number input - only allow digits
  const handleNumberInput = useCallback((
    e: React.KeyboardEvent<HTMLInputElement>,
    callbacks?: Array<{ code: string; callback: () => void }>
  ) => {
    const key = e.key

    // Allow control keys
    if (['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(key)) {
      return
    }

    // Check for callback triggers
    if (callbacks) {
      for (const cb of callbacks) {
        if (key === cb.code) {
          e.preventDefault()
          cb.callback()
          return
        }
      }
    }

    // Only allow digits
    if (!/^\d$/.test(key)) {
      e.preventDefault()
    }
  }, [])

  // Add QR code to canvas
  const addQr = useCallback(async (url: string) => {
    if (!ready || !canvas) return

     
    const workspace = canvas.getObjects().find((obj: any) => obj.id === 'workspace')
    if (!workspace) {
      alert('workspace를 등록해 주세요')
      return
    }

    const codePlugin = getPlugin<SmartCodePlugin>('SmartCodePlugin')
    const item = await codePlugin?.qrcode({
      data: url,
      width: workspace.width! / 3,
      height: workspace.width! / 3
    })

    if (item) {
      canvas.offHistory()

      const centerOf = workspace.getCenterPoint()
      item.set({
        left: centerOf.x,
        top: centerOf.y
      })

      canvas.onHistory()
      canvas.add(item)
      item.bringToFront()
      canvas.setActiveObject(item)
    }
  }, [ready, canvas, getPlugin])

  // Add barcode to canvas
  const addBarcode = useCallback(async (value: string) => {
    if (!ready || !canvas) return

     
    const workspace = canvas.getObjects().find((obj: any) => obj.id === 'workspace')
    if (!workspace) {
      alert('workspace를 등록해 주세요')
      return
    }

    const codePlugin = getPlugin<SmartCodePlugin>('SmartCodePlugin')
    const item = await codePlugin?.barcode({
      value: value,
      text: value,
      format: barcodeType
    })

    if (item) {
      canvas.offHistory()

      const centerOf = workspace.getCenterPoint()
      item.set({
        left: centerOf.x,
        top: centerOf.y
      })

      canvas.onHistory()
      canvas.add(item)
      item.bringToFront()
      canvas.setActiveObject(item)
    }
  }, [ready, canvas, getPlugin, barcodeType])

  // Render QR code
  const renderQr = useCallback(() => {
    if (!qrUrl.trim()) {
      qrInputRef.current?.focus()
      return
    }

    addQr(qrUrl)
    console.log('QR 코드가 생성되었습니다.')
  }, [qrUrl, addQr])

  // Render barcode
  const renderBarcode = useCallback(() => {
    let value = ''

    switch (barcodeType) {
      case BarCodeType.EAN13:
        if (!ean13Value || ean13Value.length !== 12) {
          alert('12자리 숫자를 입력해주세요')
          return
        }
        value = ean13Value
        break
      case BarCodeType.EAN8:
        if (!ean8Value || ean8Value.length !== 7) {
          alert('7자리 숫자를 입력해주세요')
          return
        }
        value = ean8Value
        break
    }

    addBarcode(value)
    console.log('바코드가 생성되었습니다.')
  }, [barcodeType, ean13Value, ean8Value, addBarcode])

  // Clear barcode form when type changes
  const handleBarcodeTypeChange = useCallback((value: string) => {
    setBarcodeType(value as BarCodeType)
    setEan13Value('')
    setEan8Value('')
  }, [])

  return (
    <div className="w-full h-full flex flex-col">
      <div className="px-4 pt-4 pb-3">
      </div>

      <Tabs defaultValue="qr" className="w-full">
        <TabsList className="w-full px-4 grid grid-cols-2">
          <TabsTrigger value="qr">QR</TabsTrigger>
          <TabsTrigger value="barcode">바코드</TabsTrigger>
        </TabsList>

        {/* QR Tab */}
        <TabsContent value="qr" className="px-4 pt-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="qr-url">URL</Label>
              <Input
                id="qr-url"
                ref={qrInputRef}
                value={qrUrl}
                onChange={(e) => setQrUrl(e.target.value)}
                placeholder="URL을 입력해주세요"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    renderQr()
                  }
                }}
              />
            </div>

            <Button
              className="w-full h-12"
              style={{ backgroundColor: '#D3E5F5', color: '#0C1D29' }}
              onClick={renderQr}
            >
              코드 생성
            </Button>
          </div>
        </TabsContent>

        {/* Barcode Tab */}
        <TabsContent value="barcode" className="px-4 pt-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>바코드 타입</Label>
              <Select value={barcodeType} onValueChange={handleBarcodeTypeChange}>
                <SelectTrigger>
                  <SelectValue placeholder="바코드 타입 선택" />
                </SelectTrigger>
                <SelectContent>
                  {barcodeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {barcodeType === BarCodeType.EAN13 && (
              <div className="flex flex-col gap-2">
                <Label>데이터</Label>
                <div className="relative">
                  <Input
                    value={ean13Value}
                    onChange={(e) => setEan13Value(e.target.value.slice(0, 12))}
                    placeholder="12자리 숫자를 입력해 주세요"
                    maxLength={12}
                    onKeyDown={(e) => handleNumberInput(e, [
                      { code: 'Enter', callback: renderBarcode }
                    ])}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {ean13Value.length}/12
                  </span>
                </div>
              </div>
            )}

            {barcodeType === BarCodeType.EAN8 && (
              <div className="flex flex-col gap-2">
                <Label>데이터</Label>
                <div className="relative">
                  <Input
                    value={ean8Value}
                    onChange={(e) => setEan8Value(e.target.value.slice(0, 7))}
                    placeholder="7자리 숫자를 입력해 주세요"
                    maxLength={7}
                    onKeyDown={(e) => handleNumberInput(e, [
                      { code: 'Enter', callback: renderBarcode }
                    ])}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {ean8Value.length}/7
                  </span>
                </div>
              </div>
            )}

            <Button
              className="w-full h-12"
              style={{ backgroundColor: '#D3E5F5', color: '#0C1D29' }}
              onClick={renderBarcode}
            >
              코드 생성
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
