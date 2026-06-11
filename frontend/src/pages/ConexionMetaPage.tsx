import { PageHeader } from '../design-system/PageHeader';
import { MetaConnectionPanel } from '../meta/MetaDemoTabs';

export default function ConexionMetaPage() {
  return (
    <>
      <PageHeader
        title="Conexión con Meta"
        subtitle="Conecta tu Business Manager con un token de usuario del sistema (solo lectura)."
      />
      <MetaConnectionPanel />
    </>
  );
}
