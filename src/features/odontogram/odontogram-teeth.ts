import type { Dentition, ToothArch, ToothSurface } from './odontogram-types'

/**
 * Datos FDI y orientación clínica del odontograma.
 *
 * Las filas se dibujan como se mira al paciente de frente:
 * - Arcada superior: cuadrante 1 (`18…11`) a la izquierda del observador y
 *   cuadrante 2 (`21…28`) a la derecha.
 * - Arcada inferior: cuadrante 4 (`48…41`) a la izquierda y cuadrante 3
 *   (`31…38`) a la derecha.
 * - Dentición temporal: cuadrantes 5 y 6 arriba (`55…51`, `61…65`) y 8 y 7
 *   abajo (`85…81`, `71…75`).
 *
 * Para cada pieza, mesial es la cara que mira a la línea media y distal la
 * opuesta; vestibular mira hacia fuera de la arcada y lingual/palatino hacia
 * dentro. Ese reparto es el que pinta el SVG al hacer clic en cada cara.
 */

export type SurfacePosition = 'top' | 'bottom' | 'left' | 'right' | 'center'

export type ToothRow = {
  arch: ToothArch
  numbers: number[]
}

const PERMANENT_UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
const PERMANENT_LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]
const TEMPORARY_UPPER = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65]
const TEMPORARY_LOWER = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75]

export const TOOTH_ROWS: Record<Dentition, { upper: number[]; lower: number[] }> = {
  permanent: { upper: PERMANENT_UPPER, lower: PERMANENT_LOWER },
  temporary: { upper: TEMPORARY_UPPER, lower: TEMPORARY_LOWER },
}

const PERMANENT_NAMES: Record<number, string> = {
  1: 'Incisivo central',
  2: 'Incisivo lateral',
  3: 'Canino',
  4: 'Primer premolar',
  5: 'Segundo premolar',
  6: 'Primer molar',
  7: 'Segundo molar',
  8: 'Tercer molar',
}

const TEMPORARY_NAMES: Record<number, string> = {
  1: 'Incisivo central',
  2: 'Incisivo lateral',
  3: 'Canino',
  4: 'Primer molar',
  5: 'Segundo molar',
}

export const DENTITION_OPTIONS: { value: Dentition; label: string; hint: string }[] = [
  { value: 'permanent', label: 'Permanente', hint: 'FDI 11-48' },
  { value: 'temporary', label: 'Temporal', hint: 'FDI 51-85' },
]

/** Cuadrante FDI (1-8) de la pieza. */
export function getToothQuadrant(toothNumber: number): number {
  return Math.trunc(toothNumber / 10)
}

/** Posición de la pieza dentro del cuadrante (1-8). */
export function getToothPosition(toothNumber: number): number {
  return toothNumber % 10
}

export function isTemporaryTooth(toothNumber: number): boolean {
  const quadrant = getToothQuadrant(toothNumber)

  return quadrant >= 5 && quadrant <= 8
}

/** Misma regla que el trigger `validate_odontogram_item` de la base. */
export function isValidTooth(toothNumber: number, dentition: Dentition): boolean {
  const quadrant = getToothQuadrant(toothNumber)
  const position = getToothPosition(toothNumber)

  if (dentition === 'permanent') {
    return quadrant >= 1 && quadrant <= 4 && position >= 1 && position <= 8
  }

  return quadrant >= 5 && quadrant <= 8 && position >= 1 && position <= 5
}

/** Nombre clínico: `16` → `Primer molar`. */
export function getToothName(toothNumber: number): string {
  const names = isTemporaryTooth(toothNumber) ? TEMPORARY_NAMES : PERMANENT_NAMES

  return names[getToothPosition(toothNumber)] ?? 'Pieza dental'
}

/** `16` → `Primer molar (16)` para etiquetas accesibles y tooltips. */
export function getToothTitle(toothNumber: number): string {
  return `${getToothName(toothNumber)} (${toothNumber})`
}

/** Lado del SVG donde cae la cara mesial según el cuadrante. */
export function getMesialSide(quadrant: number): 'left' | 'right' {
  // Cuadrantes 1 y 4 quedan a la izquierda del observador: su mesial apunta
  // hacia la línea media, es decir, a la derecha.
  return quadrant === 1 || quadrant === 4 ? 'right' : 'left'
}

/**
 * Ubicación de cada cara dentro del cuadrado de la pieza.
 * La vestibular siempre mira hacia fuera de la arcada (arriba en la superior,
 * abajo en la inferior) y la lingual/palatino hacia dentro.
 */
export function getSurfaceSides(
  arch: ToothArch,
  quadrant: number,
): Record<ToothSurface, SurfacePosition> {
  const mesial = getMesialSide(quadrant)
  const distal = mesial === 'right' ? 'left' : 'right'

  return {
    occlusal: 'center',
    vestibular: arch === 'upper' ? 'top' : 'bottom',
    lingual: arch === 'upper' ? 'bottom' : 'top',
    mesial,
    distal,
  }
}
