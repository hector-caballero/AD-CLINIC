import { useId } from 'react'

/*
 * Isotipo oficial de AD Clinic: diente estilizado con el monograma «AD» en
 * negativo sobre un sello marfil con filete dorado.
 *
 * La geometría es espejo de `scripts/generate-brand-assets.mjs`, que es quien
 * genera el favicon y los iconos de la PWA a partir de las mismas coordenadas.
 */
const TOOTH_PATH = [
  'M32 8.8',
  'C26.2 4.2 17.4 4.6 13.3 9.6',
  'C9.2 14.6 9.9 21.4 11.6 27.6',
  'C12.6 31.2 13.6 34.9 14.5 39.2',
  'C15.3 43 16 46.9 17.6 50.1',
  'C18.4 51.7 19.5 53 21 53.1',
  'C23.2 53.2 24.1 51.1 24.7 48.7',
  'C25.4 46 25.9 42.9 26.9 40.3',
  'C27.7 38.2 29.2 36.8 32 36.8',
  'C34.8 36.8 36.3 38.2 37.1 40.3',
  'C38.1 42.9 38.6 46 39.3 48.7',
  'C39.9 51.1 40.8 53.2 43 53.1',
  'C44.5 53 45.6 51.7 46.4 50.1',
  'C48 46.9 48.7 43 49.5 39.2',
  'C50.4 34.9 51.4 31.2 52.4 27.6',
  'C54.1 21.4 54.8 14.6 50.7 9.6',
  'C46.6 4.6 37.8 4.2 32 8.8',
  'Z',
].join(' ')

const MONOGRAM_PATHS = [
  'M20.8 30.8 L25.4 17.6 L30 30.8',
  'M22.9 26.4 H27.5',
  'M34.4 17.6 V30.8',
  'M34.4 17.6 H36.9 A6.6 6.6 0 0 1 36.9 30.8 H34.4',
]

type LogoProps = {
  /** Lado del isotipo en píxeles. */
  size?: number
  /** `light` para fondos oscuros. */
  tone?: 'dark' | 'light'
  /** Oculta el descriptor «Odontología estética». */
  hideTagline?: boolean
  className?: string
}

/**
 * Logotipo de la clínica: isotipo + nombre.
 *
 * El isotipo se dibuja en SVG (no como `<img>`) para que los degradados usen
 * la paleta de marca y el logotipo se vea nítido en cualquier tamaño y con
 * cualquier zoom, incluidas las pantallas retina.
 */
export function Logo({ size = 40, tone = 'dark', hideTagline = false, className = '' }: LogoProps) {
  // `useId()` devuelve valores con «:» que no son válidos dentro de url(#…).
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const gradientId = `ad-gold-${uid}`
  const badgeId = `ad-badge-${uid}`

  return (
    <span className={`inline-flex min-w-0 items-center gap-2.5 ${className}`}>
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        aria-hidden="true"
        className="shrink-0 drop-shadow-[0_6px_14px_rgba(154,123,86,0.22)]"
      >
        <defs>
          <linearGradient id={badgeId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.55" stopColor="#fcfbf9" />
            <stop offset="1" stopColor="#faf8f5" />
          </linearGradient>
          <linearGradient id={gradientId} x1="13" y1="7" x2="51" y2="55" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#e7cb84" />
            <stop offset="0.42" stopColor="#d4af37" />
            <stop offset="1" stopColor="#9a7b56" />
          </linearGradient>
        </defs>

        <rect width="64" height="64" rx="14" fill={`url(#${badgeId})`} />
        <rect
          x="2.4"
          y="2.4"
          width="59.2"
          height="59.2"
          rx="12.4"
          fill="none"
          stroke="#d4af37"
          strokeOpacity="0.45"
          strokeWidth="0.9"
        />
        <path
          d={TOOTH_PATH}
          fill={`url(#${gradientId})`}
          stroke="#a57c33"
          strokeOpacity="0.55"
          strokeWidth="1"
          strokeLinejoin="round"
        />
        <g
          fill="none"
          stroke="#fffcf5"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {MONOGRAM_PATHS.map((path) => (
            <path key={path} d={path} />
          ))}
        </g>
      </svg>

      <span className="min-w-0">
        <span
          className={`block truncate font-display text-[15px] leading-tight font-semibold tracking-[0.16em] uppercase ${
            tone === 'light' ? 'text-white' : 'text-ink-900'
          }`}
        >
          AD Clinic
        </span>
        {!hideTagline && (
          <span
            className={`mt-1 block truncate text-[9px] leading-none font-medium tracking-[0.24em] uppercase ${
              tone === 'light' ? 'text-brand-200/80' : 'text-bronze-600'
            }`}
          >
            Odontología estética
          </span>
        )}
      </span>
    </span>
  )
}
