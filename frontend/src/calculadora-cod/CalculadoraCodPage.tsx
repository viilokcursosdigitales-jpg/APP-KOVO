import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../design-system/PageHeader';
import { ds } from '../design-system/ds';
import type { CurrencyCode } from './types';
import { SaveBar } from './components/SaveBar';
import { InputsPanel } from './components/InputsPanel';
import { PacksSummary } from './components/PacksSummary';
import { SensitivitySection } from './components/SensitivitySection';
import { PygStatement } from './components/PygStatement';
import { MixCalculator } from './components/MixCalculator';
import { useCalculadoraCod } from './hooks/useCalculadoraCod';
import { useCalculosGuardados } from './hooks/useCalculosGuardados';
import { normalizeName } from './utils/formatters';

export default function CalculadoraCodPage() {
  const calc = useCalculadoraCod();
  const saved = useCalculosGuardados();
  const [saveSearch, setSaveSearch] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);

  useEffect(() => {
    void saved.refreshProductos();
  }, [saved.refreshProductos]);

  const onLoad = useCallback(async () => {
    const key = normalizeName(saveSearch);
    if (!key) {
      saved.setError('Escribe un nombre de producto para cargar');
      return;
    }
    const list = await saved.loadHistorico(key);
    if (!list.length) {
      saved.setError('No hay versiones guardadas para ese producto');
      return;
    }
    const chosenId =
      selectedVersionId && list.some((h) => h.id === selectedVersionId)
        ? selectedVersionId
        : list[list.length - 1].id;
    setSelectedVersionId(chosenId);
    const row = list.find((h) => h.id === chosenId);
    if (!row) return;
    const parsed = saved.applyCalculoToInputs(row);
    if (parsed) {
      calc.replaceInputs(parsed);
      setSaveSearch(parsed.productDisplayName || key);
    }
  }, [calc, saveSearch, saved, selectedVersionId]);

  const onSave = useCallback(async () => {
    const name = calc.inputs.productDisplayName.trim() || saveSearch.trim();
    if (!name.trim()) {
      saved.setError('Indica el nombre del producto antes de guardar');
      return;
    }
    const row = await saved.saveCalculo({
      productNameForKey: name,
      inputs: calc.inputs,
      kpisPayload: calc.kpisPayload as unknown as Record<string, unknown>,
    });
    if (row) {
      setSaveSearch(normalizeName(name));
      setSelectedVersionId(row.id);
    }
  }, [calc.inputs, calc.kpisPayload, saveSearch, saved]);

  const currencyCtl = (code: CurrencyCode) => {
    const active = calc.inputs.currency === code;
    return (
      <button
        key={code}
        type="button"
        onClick={() => calc.setCurrency(code)}
        style={{
          padding: '6px 12px',
          borderRadius: 8,
          border: active ? `1px solid var(--color-brand)` : `1px solid ${ds.borderCard}`,
          background: active ? 'var(--color-brand-bg)' : 'var(--color-bg-card)',
          color: active ? 'var(--color-brand)' : 'var(--color-text-muted)',
          fontWeight: 700,
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        {code}
      </button>
    );
  };

  return (
    <div
      style={{
        padding: 'var(--main-padding-y) var(--main-padding-x)',
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: 1200,
        margin: '0 auto',
      }}
    >
      <PageHeader
        title="Calculadora COD"
        subtitle="Rentabilidad dropshipping · Pago contra entrega"
        right={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{(['COP', 'USD', 'MXN'] as const).map(currencyCtl)}</div>}
      />

      {saved.error ? (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 14px',
            borderRadius: 12,
            background: 'var(--color-danger-bg)',
            color: 'var(--color-danger-text)',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {saved.error}
        </div>
      ) : null}

      <SaveBar
        searchValue={saveSearch}
        onSearchChange={(v) => {
          setSaveSearch(v);
          saved.setError(null);
        }}
        productos={saved.productos}
        historico={saved.historico}
        selectedVersionId={selectedVersionId}
        onSelectVersion={(id) => {
          setSelectedVersionId(id);
          saved.setError(null);
        }}
        onLoad={onLoad}
        onSave={onSave}
        busy={saved.loading}
        lastSavedAt={saved.lastSavedAt}
      />

      <div style={{ marginTop: 20 }} className="calc-cod-main-grid">
        <div style={{ minWidth: 0 }}>
          <InputsPanel
            inputs={calc.inputs}
            onProductName={calc.setProductDisplayName}
            onCostoUnitario={calc.setCostoUnitario}
            onPackField={calc.setPackField}
            onFleteIda={calc.setFleteIda}
            onCobraFleteDevolucion={calc.setCobraFleteDevolucion}
            onFleteDevolucion={calc.setFleteDevolucion}
            onCanceladosPct={calc.setCanceladosPct}
            onDevueltosPct={calc.setDevueltosPct}
            onAdmin={calc.setAdminPct}
            onMetaUtilidad={calc.setMetaUtilidadPct}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <PacksSummary currency={calc.inputs.currency} inputs={calc.inputs} packKpis={calc.packKpis} bestPackId={calc.bestId} />
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <SensitivitySection inputs={calc.inputs} packKpis={calc.packKpis} />
      </div>

      <div style={{ marginTop: 22 }}>
        <PygStatement inputs={calc.inputs} packKpis={calc.packKpis} />
      </div>

      <div style={{ marginTop: 22 }}>
        <MixCalculator inputs={calc.inputs} packKpis={calc.packKpis} onMixChange={calc.setMixPct} />
      </div>

      <style>{`
        .calc-cod-main-grid {
          display: grid;
          grid-template-columns: minmax(0, 0.4fr) minmax(0, 0.6fr);
          gap: var(--grid-gap);
          align-items: start;
        }
        @media (max-width: 900px) {
          .calc-cod-main-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
