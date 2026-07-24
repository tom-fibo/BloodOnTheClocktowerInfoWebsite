// Arranges a container's direct children evenly around a circle, matching the
// physical Town Square seating this is standing in for. Percentage-based
// positions are relative to the container's own box, so the container must be
// square (`aspect-ratio: 1`) or the circle will render as an ellipse.
export function layoutInCircle(container: HTMLElement): void {
  const items = Array.from(container.children) as HTMLElement[]
  const n = items.length
  if (n === 0) return

  const radius = n < 2 ? 0 : 42
  items.forEach((item, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2
    const x = 50 + radius * Math.cos(angle)
    const y = 50 + radius * Math.sin(angle)
    item.style.position = 'absolute'
    item.style.left = `${x}%`
    item.style.top = `${y}%`
    item.style.transform = 'translate(-50%, -50%)'
  })
}
