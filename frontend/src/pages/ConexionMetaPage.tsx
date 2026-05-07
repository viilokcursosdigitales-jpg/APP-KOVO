import { PageHeader } from '../design-system/PageHeader';
import { MetaConnectionPanel } from '../meta/MetaDemoTabs';

export default function ConexionMetaPage() {
  return (
    <>
      <PageHeader
        title="Conexión con Meta"
        subtitle="Conecta con Meta mediante OAuth (recomendado) o gestiona el acceso a tus anuncios"
      />
      <MetaConnectionPanel />
    </>
  );
}
