import { Logo } from './Logo'

type BrandProps = {
  className?: string
  /** Alto del logotipo en píxeles; el ancho lo fija la proporción oficial. */
  size?: number
  /**
   * `full` mantiene el descriptor del logotipo oficial (espacios amplios);
   * `compact` lo recorta para barras, cabeceras y menús.
   */
  variant?: 'full' | 'compact'
}

/** Logotipo institucional, reutilizado en login y en la navegación. */
export function Brand({ className = '', size = 40, variant = 'compact' }: BrandProps) {
  return <Logo size={size} variant={variant} className={className} />
}

