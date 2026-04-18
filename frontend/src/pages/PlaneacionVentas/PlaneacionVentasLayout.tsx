import { Outlet } from 'react-router-dom';
import { PlanesVentasProvider } from '../../hooks/usePlanesVentas';

/** Layout del módulo: provee estado compartido de planes a lista y detalle. */
export default function PlaneacionVentasLayout() {
  return (
    <PlanesVentasProvider>
      <Outlet />
    </PlanesVentasProvider>
  );
}
