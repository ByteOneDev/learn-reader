// Géométrie de l'hémicycle : fonctions pures, testées sans DOM.

export const W = 560
export const H = 340
export const CX = W / 2
export const CY = 270
export const SEAT_R = 22

export interface Seat {
  x: number
  y: number
  angle: number
}

/** Places d'un hémicycle : rangées concentriques, sièges répartis proportionnellement au rayon. */
export function hemicycleSeats(n: number): Seat[] {
  if (n === 0) return []
  const rows = n <= 8 ? 1 : n <= 18 ? 2 : 3
  const radii = Array.from({ length: rows }, (_, r) => 140 + r * 58)
  const total = radii.reduce((a, b) => a + b, 0)
  const perRow = radii.map((r) => Math.max(1, Math.round((n * r) / total)))
  let diff = n - perRow.reduce((a, b) => a + b, 0)
  for (let r = rows - 1; diff !== 0; r = (r - 1 + rows) % rows) {
    perRow[r] += Math.sign(diff)
    diff -= Math.sign(diff)
  }
  const seats: Seat[] = []
  radii.forEach((radius, r) => {
    const k = perRow[r]
    for (let j = 0; j < k; j++) {
      const angle = k === 1 ? Math.PI / 2 : Math.PI - (j * Math.PI) / (k - 1)
      seats.push({ x: CX + radius * Math.cos(angle), y: CY - radius * Math.sin(angle), angle })
    }
  })
  // De gauche à droite, puis de l'intérieur vers l'extérieur.
  return seats.sort((a, b) => b.angle - a.angle || a.y - b.y)
}

/** Abréviation lisible : « Le Figaro — Politique » → « Fi », « Valeurs actuelles » → « VA ». */
export function initials(title: string): string {
  const core = title
    .split(/\s+[—–-]\s+/)[0]
    .replace(/^(Le|La|Les|The)\s+|^L['’]/i, '')
    .trim()
  const words = core.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return core.slice(0, 1).toUpperCase() + core.slice(1, 2).toLowerCase()
}
