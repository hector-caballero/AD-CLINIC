import { Logo } from './Logo'

type BrandProps = {
  className?: string
  /** `true` para fondos de marca oscuros (texto claro). */
  inverted?: boolean
  /** Lado del isotipo en píxeles. */
  size?: number
  /** Oculta el descriptor «Odontología estética» en espacios estrechos. */
  hideTagline?: boolean
}

/** Logotipo + nombre de la clínica, reutilizado en login y en la navegación. */
export function Brand({
  className = '',
  inverted = false,
  size = 40,
  hideTagline = false,
}: BrandProps) {
  return (
    <Logo
      size={size}
      tone={inverted ? 'light' : 'dark'}
      hideTagline={hideTagline}
      className={className}
    />
  )
}

