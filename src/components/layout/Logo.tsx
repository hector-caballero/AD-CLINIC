/*
 * Logotipo oficial de AD Clinic.
 *
 * Se muestra tal cual el archivo aprobado `public/brand/logo-original.jpeg`
 * (1280 × 747): diente + wordmark «AD CLINIC» + descriptor sobre fondo carbón.
 * No se redibuja ni se recolorea; el JPEG trae su propio fondo y por eso se
 * encuadra en una placa redondeada que convive con la interfaz marfil.
 *
 * Dos encuadres del mismo archivo:
 * - `full`    → el original completo, descriptor incluido (`object-contain`).
 * - `compact` → recorte de la banda de contenido para barras y cabeceras: a 40 px
 *               de alto el original dejaría el wordmark ilegible, porque el 66 %
 *               de su alto es aire y descriptor. `object-cover` recorta sin
 *               deformar (mantiene la proporción del archivo).
 *
 * Medidas tomadas sobre el original (px): contenido 200–443, descriptor 471–499,
 * banda visible del recorte 150–455 (1280 × 305).
 */

/** Original en `public/`: Vite lo sirve desde la raíz del sitio. */
const LOGO_SRC = '/brand/logo-original.jpeg'

/** Proporción del original: 1280 × 747 ≈ 1,714. */
const RATIO_FULL = 1280 / 747

/** Proporción de la banda del recorte: 1280 × 305 ≈ 4,197. */
const RATIO_COMPACT = 1280 / 305

/**
 * Centro vertical de la banda dentro del original. `object-cover` deja 442 px
 * de recorrido (747 − 305) y el contenido empieza en 200 px, así que cualquier
 * valor entre 31 % y 37 % deja fuera el descriptor: 34 % centra la banda.
 */
const COMPACT_POSITION = '50% 34%'

type LogoProps = {
  /** Alto del logotipo en píxeles; el ancho sale de la proporción oficial. */
  size?: number
  /** `full` mantiene el descriptor; `compact` lo recorta para espacios estrechos. */
  variant?: 'full' | 'compact'
  className?: string
}

/**
 * Logotipo de la clínica.
 *
 * El ancho se calcula a partir del alto para no deformar el logotipo: el
 * `<img>` siempre conserva la proporción del JPEG (con `object-contain` en
 * `full` y `object-cover` en `compact`) aunque el contenedor cambie.
 */
export function Logo({ size = 40, variant = 'compact', className = '' }: LogoProps) {
  const ratio = variant === 'full' ? RATIO_FULL : RATIO_COMPACT
  const width = Math.round(size * ratio)
  const fitClass = variant === 'full' ? 'object-contain' : 'object-cover'

  return (
    <img
      src={LOGO_SRC}
      alt="AD Clinic"
      width={width}
      height={size}
      decoding="async"
      style={{
        width,
        height: size,
        objectPosition: variant === 'compact' ? COMPACT_POSITION : '50% 50%',
      }}
      className={`block shrink-0 rounded-xl bg-ink-950 shadow-card ring-1 ring-ink-900/10 ${fitClass} ${className}`}
    />
  )
}
