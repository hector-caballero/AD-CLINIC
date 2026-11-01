import { useMemo, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  ITEM_STATUS_META,
  STATUS_ORDER,
  SURFACE_OPTIONS,
  getDominantStatus,
  getSurfaceItems,
  getSurfaceLabel,
  isAbsentTooth,
  type Dentition,
  type OdontogramItem,
  type ToothArch,
  type ToothSelection,
  type ToothSurface,
} from './odontogram-types'
import {
  TOOTH_ROWS,
  getSurfaceSides,
  getToothQuadrant,
  getToothTitle,
  type SurfacePosition,
} from './odontogram-teeth'

/**
 * Odontograma SVG interactivo.
 *
 * Cada pieza es un cuadrado con cinco zonas clicables: el centro es la cara
 * oclusal/incisal, los laterales son mesial y distal (orientados hacia la línea
 * media) y arriba/abajo quedan vestibular y lingual/palatino según la arcada.
 * El número de la pieza abre el selector de «pieza completa».
 *
 * El relleno sigue la convención clínica: rojo = patología/pendiente, verde =
 * presupuestado, azul = realizado y gris con una X = pieza ausente. Cuando una
 * cara tiene varios procedimientos se pinta el estado más relevante.
 */

const TOOTH_SIZE = 44
const TOOTH_GAP = 4
const MIDLINE_EXTRA = 16
const MARGIN_X = 6
const INNER_INSET = 11
const UPPER_Y = 34
const ARCH_GAP = 56
const ROW_LABEL_SPACE = 30

type ToothLayout = {
  number: number
  arch: ToothArch
  quadrant: number
  x: number
  y: number
}

type ChartLayout = {
  teeth: ToothLayout[]
  width: number
  height: number
  lowerY: number
  midlineX: number
}

function buildLayout(dentition: Dentition): ChartLayout {
  const rows = TOOTH_ROWS[dentition]
  const count = rows.upper.length
  const half = count / 2
  const step = TOOTH_SIZE + TOOTH_GAP
  const lowerY = UPPER_Y + TOOTH_SIZE + ARCH_GAP

  const xFor = (index: number) => MARGIN_X + index * step + (index >= half ? MIDLINE_EXTRA : 0)

  const upper = rows.upper.map((number, index) => ({
    number,
    arch: 'upper' as const,
    quadrant: getToothQuadrant(number),
    x: xFor(index),
    y: UPPER_Y,
  }))

  const lower = rows.lower.map((number, index) => ({
    number,
    arch: 'lower' as const,
    quadrant: getToothQuadrant(number),
    x: xFor(index),
    y: lowerY,
  }))

  const width = MARGIN_X * 2 + count * TOOTH_SIZE + (count - 1) * TOOTH_GAP + MIDLINE_EXTRA

  return {
    teeth: [...upper, ...lower],
    width,
    height: lowerY + TOOTH_SIZE + ROW_LABEL_SPACE,
    lowerY,
    midlineX: MARGIN_X + half * step - TOOTH_GAP + MIDLINE_EXTRA / 2,
  }
}

/** Puntos del trapecio de cada cara; el centro se dibuja como rectángulo. */
function getPolygonPoints(position: SurfacePosition, x: number, y: number): string | null {
  const size = TOOTH_SIZE
  const inset = INNER_INSET

  switch (position) {
    case 'top':
      return [
        `${x},${y}`,
        `${x + size},${y}`,
        `${x + size - inset},${y + inset}`,
        `${x + inset},${y + inset}`,
      ].join(' ')
    case 'bottom':
      return [
        `${x},${y + size}`,
        `${x + size},${y + size}`,
        `${x + size - inset},${y + size - inset}`,
        `${x + inset},${y + size - inset}`,
      ].join(' ')
    case 'left':
      return [
        `${x},${y}`,
        `${x + inset},${y + inset}`,
        `${x + inset},${y + size - inset}`,
        `${x},${y + size}`,
      ].join(' ')
    case 'right':
      return [
        `${x + size},${y}`,
        `${x + size - inset},${y + inset}`,
        `${x + size - inset},${y + size - inset}`,
        `${x + size},${y + size}`,
      ].join(' ')
    default:
      return null
  }
}

type ToothGroupProps = {
  tooth: ToothLayout
  items: OdontogramItem[]
  selected: ToothSelection | null
  readOnly: boolean
  onSelectSurface: (toothNumber: number, surface: ToothSurface) => void
  onSelectTooth: (toothNumber: number) => void
}

function ToothGroup({
  tooth,
  items,
  selected,
  readOnly,
  onSelectSurface,
  onSelectTooth,
}: ToothGroupProps) {
  const { number, arch, quadrant, x, y } = tooth
  const surfaceSides = getSurfaceSides(arch, quadrant)
  const absent = isAbsentTooth(items, number)
  const wholeStatus = getDominantStatus(getSurfaceItems(items, number, null))
  const wholeMeta = wholeStatus ? ITEM_STATUS_META[wholeStatus] : null
  const title = getToothTitle(number)
  const isWholeSelected = selected?.toothNumber === number && selected.surface === null
  const labelY = arch === 'upper' ? y - 8 : y + TOOTH_SIZE + 15
  const centerX = x + TOOTH_SIZE / 2

  return (
    <g>
      <rect
        x={x + 0.5}
        y={y + 0.5}
        width={TOOTH_SIZE - 1}
        height={TOOTH_SIZE - 1}
        rx={7}
        fill={absent ? '#f1f5f9' : '#ffffff'}
        stroke={wholeMeta ? wholeMeta.fill : '#cbd5e1'}
        strokeWidth={wholeMeta ? 2.5 : 1}
      />

      {absent ? (
        <>
          <line
            x1={x + 7}
            y1={y + 7}
            x2={x + TOOTH_SIZE - 7}
            y2={y + TOOTH_SIZE - 7}
            stroke="#94a3b8"
            strokeWidth={2}
            strokeLinecap="round"
          />
          <line
            x1={x + TOOTH_SIZE - 7}
            y1={y + 7}
            x2={x + 7}
            y2={y + TOOTH_SIZE - 7}
            stroke="#94a3b8"
            strokeWidth={2}
            strokeLinecap="round"
          />
          <title>{`${title} — pieza ausente`}</title>
        </>
      ) : (
        SURFACE_OPTIONS.map(({ value }) => {
          const position = surfaceSides[value]
          const surfaceItems = getSurfaceItems(items, number, value)
          const status = getDominantStatus(surfaceItems)
          const meta = status ? ITEM_STATUS_META[status] : null
          const isSelected = selected?.toothNumber === number && selected.surface === value
          const points = getPolygonPoints(position, x, y)
          const baseLabel = `${title} · ${getSurfaceLabel(value)}: ${meta ? meta.label : 'sin registro'}`
          const names = surfaceItems.map((item) => item.treatment?.name ?? 'Procedimiento')
          const tooltip = names.length > 0 ? `${baseLabel} — ${names.join(', ')}` : baseLabel
          const fill = meta ? meta.fill : '#f8fafc'
          const className = readOnly ? undefined : 'cursor-pointer transition-opacity hover:opacity-75'

          const sharedProps = {
            role: 'button',
            tabIndex: readOnly ? -1 : 0,
            'aria-label': tooltip,
            'aria-pressed': isSelected,
            className,
            onClick: () => {
              if (!readOnly) onSelectSurface(number, value)
            },
            onKeyDown: (event: ReactKeyboardEvent<SVGElement>) => {
              if (readOnly || (event.key !== 'Enter' && event.key !== ' ')) return

              event.preventDefault()
              onSelectSurface(number, value)
            },
          }

          return points ? (
            <polygon
              key={value}
              points={points}
              fill={fill}
              fillOpacity={meta ? 0.9 : 1}
              stroke={isSelected ? '#0891b2' : '#e2e8f0'}
              strokeWidth={isSelected ? 2 : 1}
              {...sharedProps}
            >
              <title>{tooltip}</title>
            </polygon>
          ) : (
            <rect
              key={value}
              x={x + INNER_INSET}
              y={y + INNER_INSET}
              width={TOOTH_SIZE - INNER_INSET * 2}
              height={TOOTH_SIZE - INNER_INSET * 2}
              rx={3}
              fill={fill}
              fillOpacity={meta ? 0.9 : 1}
              stroke={isSelected ? '#0891b2' : '#e2e8f0'}
              strokeWidth={isSelected ? 2 : 1}
              {...sharedProps}
            >
              <title>{tooltip}</title>
            </rect>
          )
        })
      )}

      <g
        role="button"
        tabIndex={readOnly ? -1 : 0}
        aria-label={`${title}: seleccionar pieza completa`}
        className={readOnly ? undefined : 'cursor-pointer'}
        onClick={() => {
          if (!readOnly) onSelectTooth(number)
        }}
        onKeyDown={(event) => {
          if (readOnly || (event.key !== 'Enter' && event.key !== ' ')) return

          event.preventDefault()
          onSelectTooth(number)
        }}
      >
        <rect
          x={centerX - 15}
          y={labelY - 12}
          width={30}
          height={17}
          rx={4}
          fill={isWholeSelected ? '#cffafe' : 'transparent'}
        />
        <text
          x={centerX}
          y={labelY}
          textAnchor="middle"
          fontSize={11}
          fontWeight={isWholeSelected ? 700 : 500}
          fill={isWholeSelected ? '#0e7490' : '#64748b'}
        >
          {number}
        </text>
        <title>{`${title} — seleccionar pieza completa`}</title>
      </g>

      {wholeMeta && (
        <circle
          cx={x + TOOTH_SIZE - 7}
          cy={y + 7}
          r={3.5}
          fill={wholeMeta.fill}
          stroke="#ffffff"
          strokeWidth={1.5}
        >
          <title>{`${title} — pieza completa: ${wholeMeta.label}`}</title>
        </circle>
      )}
    </g>
  )
}

/** Leyenda de estados (mismos colores que el presupuesto). */
function OdontogramLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
      {STATUS_ORDER.map((status) => {
        const meta = ITEM_STATUS_META[status]

        return (
          <li key={status} className="inline-flex items-center gap-1.5">
            <span className={`size-2.5 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
            {meta.label}
          </li>
        )
      })}
      <li className="inline-flex items-center gap-1.5">
        <span
          className="size-2.5 shrink-0 rounded-full border-2 border-slate-500 bg-white"
          aria-hidden="true"
        />
        Borde = pieza completa
      </li>
    </ul>
  )
}

export type OdontogramChartProps = {
  dentition: Dentition
  items: OdontogramItem[]
  selected?: ToothSelection | null
  /** Recepción puede consultar el mapa, pero solo odontología lo edita. */
  readOnly?: boolean
  onSelectSurface: (toothNumber: number, surface: ToothSurface) => void
  onSelectTooth: (toothNumber: number) => void
}

/**
 * Mapa dental de las dos arcadas. En pantallas angostas se desplaza en
 * horizontal en lugar de reducir las piezas hasta volverlas intocables.
 */
export function OdontogramChart({
  dentition,
  items,
  selected = null,
  readOnly = false,
  onSelectSurface,
  onSelectTooth,
}: OdontogramChartProps) {
  const layout = useMemo(() => buildLayout(dentition), [dentition])

  return (
    <div className="space-y-3">
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="group"
          aria-label={`Odontograma ${
            dentition === 'permanent' ? 'permanente' : 'temporal'
          } con ${layout.teeth.length} piezas`}
          className="block h-auto w-full"
          style={{ minWidth: layout.width }}
        >
          <text x={MARGIN_X} y={13} fontSize={10} fontWeight={600} fill="#94a3b8" letterSpacing={1}>
            ARCADA SUPERIOR
          </text>

          <line
            x1={layout.midlineX}
            y1={UPPER_Y - 16}
            x2={layout.midlineX}
            y2={layout.lowerY + TOOTH_SIZE + 6}
            stroke="#e2e8f0"
            strokeWidth={1}
            strokeDasharray="3 4"
          />

          {layout.teeth.map((tooth) => (
            <ToothGroup
              key={tooth.number}
              tooth={tooth}
              items={items}
              selected={selected}
              readOnly={readOnly}
              onSelectSurface={onSelectSurface}
              onSelectTooth={onSelectTooth}
            />
          ))}

          <text
            x={MARGIN_X}
            y={layout.lowerY + TOOTH_SIZE + 26}
            fontSize={10}
            fontWeight={600}
            fill="#94a3b8"
            letterSpacing={1}
          >
            ARCADA INFERIOR
          </text>
        </svg>
      </div>

      <OdontogramLegend />

      <p className="text-xs leading-relaxed text-slate-500">
        {readOnly
          ? 'Tu perfil puede consultar el odontograma; para registrar o cambiar procedimientos necesitás rol de odontología o administración.'
          : 'Tocá una cara para agregar el procedimiento; el número de la pieza abre la opción de pieza completa o de marcar la pieza como ausente.'}
      </p>
    </div>
  )
}
