#!/usr/bin/env node
/**
 * Identidad visual de AD Clinic: genera los SVG y los PNG de la PWA.
 *
 * El isotipo es un diente estilizado con el monograma «AD» en negativo. Todas
 * las piezas salen del mismo trazado vectorial (las constantes de abajo), así
 * que el favicon, los iconos del manifest y el logotipo del navbar no se
 * desincronizan.
 *
 * Uso:
 *   npm run brand:assets
 *
 * Rasteriza con un Chrome/Edge en modo headless (`--headless=new`). Si el
 * navegador no está en una ruta conocida, se puede indicar con `CHROME_PATH`.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC_DIR = path.join(ROOT, 'public')
const ICONS_DIR = path.join(PUBLIC_DIR, 'icons')
const BRAND_DIR = path.join(PUBLIC_DIR, 'brand')

/* --------------------------------------------------------------------------
 * Paleta (misma que `src/index.css`)
 * ------------------------------------------------------------------------ */
const COLORS = {
  ivory: '#FCFBF9',
  ivoryWarm: '#FAF8F5',
  champagne: '#D4AF37',
  champagneLight: '#E7CB84',
  bronze: '#9A7B56',
  bronzeDeep: '#8A6B3F',
  ink: '#2A2724',
  cream: '#FFFCF5',
}

/* --------------------------------------------------------------------------
 * Trazado del isotipo (lienzo lógico de 64 × 64)
 * ------------------------------------------------------------------------ */
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

/** «A» y «D» trazadas con el mismo grosor que el contorno del diente. */
const MONOGRAM_PATHS = [
  'M20.8 30.8 L25.4 17.6 L30 30.8',
  'M22.9 26.4 H27.5',
  'M34.4 17.6 V30.8',
  'M34.4 17.6 H36.9 A6.6 6.6 0 0 1 36.9 30.8 H34.4',
]

function goldGradient(id) {
  return `<linearGradient id="${id}" x1="13" y1="7" x2="51" y2="55" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${COLORS.champagneLight}"/>
      <stop offset="0.42" stop-color="${COLORS.champagne}"/>
      <stop offset="1" stop-color="${COLORS.bronze}"/>
    </linearGradient>`
}

function badgeGradient(id) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="0.55" stop-color="${COLORS.ivory}"/>
      <stop offset="1" stop-color="${COLORS.ivoryWarm}"/>
    </linearGradient>`
}

/** Isotipo suelto: solo el diente con el monograma. */
function markGroup({ scale = 1, translateX = 0, translateY = 0, gradientId = 'gold' }) {
  const transform =
    scale === 1 && translateX === 0 && translateY === 0
      ? ''
      : ` transform="translate(${translateX} ${translateY}) scale(${scale})"`

  return `<g${transform}>
      <path d="${TOOTH_PATH}" fill="url(#${gradientId})" stroke="#A57C33" stroke-opacity="0.55" stroke-width="1" stroke-linejoin="round"/>
      <g fill="none" stroke="${COLORS.cream}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        ${MONOGRAM_PATHS.map((d) => `<path d="${d}"/>`).join('\n        ')}
      </g>
    </g>`
}

/**
 * Icono cuadrado de la app.
 * `maskable`: fondo a sangre (sin esquinas redondeadas propias) y el isotipo
 * dentro del 80 % central que garantiza la zona segura de Android.
 */
function buildIconSvg({ maskable = false, toothRatio = 0.62 } = {}) {
  const radius = maskable ? 0 : 14
  const frameInset = 2.4
  // El diente ocupa ~46 unidades de ancho en el lienzo de 64.
  const scale = (64 * toothRatio) / 46
  const translateX = 32 - 32 * scale
  const translateY = 30 - 32 * scale

  /*
   * El icono maskable no lleva marco propio: Android recorta con la forma que
   * quiera (círculo, squircle, gota…) y cualquier borde quedaría mutilado. El
   * fondo marfil llega a sangre y el isotipo vive dentro del 80 % central.
   */
  const frame = maskable
    ? ''
    : `<rect x="${frameInset}" y="${frameInset}" width="${64 - frameInset * 2}" height="${64 - frameInset * 2}" rx="${radius - 1.6}" fill="none" stroke="${COLORS.champagne}" stroke-opacity="0.45" stroke-width="0.9"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="AD Clinic">
  <defs>
    ${badgeGradient('badge')}
    ${goldGradient('gold')}
  </defs>
  <rect width="64" height="64" rx="${radius}" fill="url(#badge)"/>
  ${frame}
  ${markGroup({ scale, translateX, translateY })}
</svg>`
}

/** Logotipo completo (isotipo + nombre) para usos externos: correo, docs, OG. */
function buildLogoSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 72" width="300" height="72" role="img" aria-label="AD Clinic · Odontología">
  <defs>
    ${badgeGradient('badge')}
    ${goldGradient('gold')}
  </defs>
  <g transform="translate(0 4)">
    <rect width="64" height="64" rx="14" fill="url(#badge)"/>
    <rect x="2.4" y="2.4" width="59.2" height="59.2" rx="12.4" fill="none" stroke="${COLORS.champagne}" stroke-opacity="0.45" stroke-width="0.9"/>
    <g transform="translate(32 32) scale(1.06) translate(-32 -32)">${markGroup({})}</g>
  </g>
  <text x="82" y="34" fill="${COLORS.ink}" font-family="Georgia, 'Times New Roman', serif" font-size="27" font-weight="600" letter-spacing="3.4">AD CLINIC</text>
  <text x="83" y="55" fill="${COLORS.bronze}" font-family="system-ui, 'Segoe UI', Roboto, sans-serif" font-size="9" letter-spacing="4">ODONTOLOGÍA ESTÉTICA</text>
</svg>`
}

/* --------------------------------------------------------------------------
 * Rasterizado con Chrome/Edge headless
 * ------------------------------------------------------------------------ */
function findBrowser() {
  const fromEnv = process.env.CHROME_PATH
  if (fromEnv && existsSync(fromEnv)) return fromEnv

  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
      : [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
        ]

  const found = candidates.find((candidate) => existsSync(candidate))

  if (!found) {
    throw new Error(
      'No encontramos Chrome/Edge para rasterizar. Instalá uno o definí CHROME_PATH con la ruta al ejecutable.',
    )
  }

  return found
}

const BROWSER = findBrowser()
const WORK_DIR = mkdtempSync(path.join(tmpdir(), 'ad-clinic-brand-'))

function renderPng(svg, size, target) {
  const htmlPath = path.join(WORK_DIR, `render-${size}-${path.basename(target, '.png')}.html`)
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent}
    svg{display:block;width:${size}px;height:${size}px}
  </style></head><body>${svg}</body></html>`

  writeFileSync(htmlPath, html, 'utf8')

  execFileSync(
    BROWSER,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      `--window-size=${size},${size}`,
      `--screenshot=${target}`,
      `file:///${htmlPath.replace(/\\/g, '/')}`,
    ],
    { stdio: 'ignore' },
  )

  console.log(`  · ${path.relative(ROOT, target)} (${size}×${size})`)
}

/** Ensambla un .ico con PNG incrustados (soportado desde Windows Vista). */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reservado
  header.writeUInt16LE(1, 2) // tipo: icono
  header.writeUInt16LE(entries.length, 4)

  const directory = Buffer.alloc(16 * entries.length)
  const payloads = []
  let offset = header.length + directory.length

  entries.forEach(({ size, data }, index) => {
    const cursor = index * 16
    directory.writeUInt8(size >= 256 ? 0 : size, cursor)
    directory.writeUInt8(size >= 256 ? 0 : size, cursor + 1)
    directory.writeUInt8(0, cursor + 2) // sin paleta
    directory.writeUInt8(0, cursor + 3) // reservado
    directory.writeUInt16LE(1, cursor + 4) // planos
    directory.writeUInt16LE(32, cursor + 6) // bits por píxel
    directory.writeUInt32LE(data.length, cursor + 8)
    directory.writeUInt32LE(offset, cursor + 12)

    offset += data.length
    payloads.push(data)
  })

  return Buffer.concat([header, directory, ...payloads])
}

/* --------------------------------------------------------------------------
 * Generación
 * ------------------------------------------------------------------------ */
mkdirSync(ICONS_DIR, { recursive: true })
mkdirSync(BRAND_DIR, { recursive: true })

const badgeSvg = buildIconSvg({ toothRatio: 0.66 })
const maskableSvg = buildIconSvg({ maskable: true, toothRatio: 0.5 })
const appleSvg = buildIconSvg({ maskable: true, toothRatio: 0.58 })

console.log('AD Clinic · generando identidad visual')

for (const [target, content] of [
  [path.join(PUBLIC_DIR, 'favicon.svg'), badgeSvg],
  [path.join(ICONS_DIR, 'icon.svg'), badgeSvg],
  [path.join(BRAND_DIR, 'ad-clinic-mark.svg'), badgeSvg],
  [path.join(BRAND_DIR, 'ad-clinic-logo.svg'), buildLogoSvg()],
]) {
  writeFileSync(target, content, 'utf8')
  console.log(`  · ${path.relative(ROOT, target)}`)
}

renderPng(badgeSvg, 192, path.join(ICONS_DIR, 'icon-192.png'))
renderPng(badgeSvg, 512, path.join(ICONS_DIR, 'icon-512.png'))
renderPng(maskableSvg, 192, path.join(ICONS_DIR, 'maskable-192.png'))
renderPng(maskableSvg, 512, path.join(ICONS_DIR, 'maskable-512.png'))
renderPng(appleSvg, 180, path.join(ICONS_DIR, 'apple-touch-icon-180.png'))

const icoSizes = [16, 32, 48]
const icoEntries = icoSizes.map((size) => {
  const file = path.join(WORK_DIR, `favicon-${size}.png`)
  renderPng(badgeSvg, size, file)

  return { size, data: readFileSync(file) }
})

writeFileSync(path.join(PUBLIC_DIR, 'favicon.ico'), buildIco(icoEntries))
console.log(`  · public/favicon.ico (${icoSizes.join(', ')} px)`)

rmSync(WORK_DIR, { recursive: true, force: true })
console.log('Listo: assets de marca actualizados.')
