import qrcode from 'qrcode-generator'
import { el } from './dom'

// Renders a self-contained SVG QR code encoding `url`. The markup comes only
// from qrcode-generator's own output (rects for the QR pattern), never from
// user-controlled text, so setting it via innerHTML carries no injection risk.
export function renderQrCode(url: string): HTMLElement {
  const qr = qrcode(0, 'M')
  qr.addData(url)
  qr.make()

  const container = el('div', { className: 'qr-code' })
  container.innerHTML = qr.createSvgTag(4, 8)
  return container
}
