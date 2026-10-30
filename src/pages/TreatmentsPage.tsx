import { ComingSoon } from '../components/ui/ComingSoon'

export default function TreatmentsPage() {
  return (
    <ComingSoon
      title="Tratamientos"
      description="Catálogo de tratamientos con precio y duración, y plan de tratamiento asignado a cada paciente."
      bullets={[
        'Catálogo editable con precio y duración por defecto',
        'Asignación de tratamientos a la ficha del paciente',
        'Precio congelado en el momento del alta',
        'Numeración FDI de las piezas dentales',
      ]}
    />
  )
}
