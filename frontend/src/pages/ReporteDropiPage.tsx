import { PageHeader } from '../design-system/PageHeader';
import { ds } from '../design-system/ds';

export default function ReporteDropiPage() {
  return (
    <div style={{ maxWidth: 980 }}>
      <PageHeader title="Reporte Dropi" subtitle="Próximamente" />
      <div
        style={{
          border: `1px solid ${ds.borderCard}`,
          borderRadius: 12,
          background: ds.bgCard,
          padding: 18,
          color: ds.textSecondary,
          fontSize: 13,
        }}
      >
        Este módulo estará disponible próximamente.
      </div>
    </div>
  );
}
