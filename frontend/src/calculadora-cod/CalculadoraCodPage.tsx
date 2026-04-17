import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../design-system/PageHeader';
import { ds } from '../design-system/ds';
import type { CurrencyCode, FunnelMixLevel } from './types';
import { SaveBar } from './components/SaveBar';
import { ProductosGuardadosList } from './components/ProductosGuardadosList';
import { InputsPanel } from './components/InputsPanel';
import { PacksSummary } from './components/PacksSummary';
import { SensitivitySection } from './components/SensitivitySection';
import { PygStatement } from './components/PygStatement';
import { MixCalculator } from './components/MixCalculator';
import { useCalculadoraCod } from './hooks/useCalculadoraCod';
import { useCalculosGuardados } from './hooks/useCalculosGuardados';
import { normalizeName } from './utils/formatters';

type Screen = 'lista' | 'calculadora';

export default function CalculadoraCodPage() {
  const calc = useCalculadoraCod();
  const saved = useCalculosGuardados();
  const [screen, setScreen] = useState<Screen>('lista');
  const [listBootstrapping, setListBootstrapping] = useState(true);
  const [saveSearch, setSaveSearch] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [mixFunnelLevel, setMixFunnelLevel] = useState<FunnelMixLevel>('gen');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await saved.refreshProductos();
      } finally {
        if (alive) setListBootstrapping(false);
      }
    })();
    return () => {
      alive = false;
    };
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
    if (!parsed) {
      saved.setError(
        'Esta versión tiene datos incompletos o dañados y no se pudo cargar. Elige otra versión del historial o revisa el registro en base de datos.',
      );
      return;
    }
    calc.replaceInputs(parsed);
    setSaveSearch(parsed.productDisplayName || key);
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

  const volverALista = useCallback(() => {
    saved.setError(null);
    void saved.refreshProductos();
    setScreen('lista');
  }, [saved]);

  const abrirNuevoCalculo = useCallback(() => {
    saved.setError(null);
    calc.resetToDefaults();
    setSaveSearch('');
    setSelectedVersionId(null);
    void saved.loadHistorico('');
    setMixFunnelLevel('gen');
    setScreen('calculadora');
  }, [calc, saved]);

  const abrirProductoGuardado = useCallback(
    async (productKey: string) => {
      saved.setError(null);
      const key = normalizeName(productKey);
      if (!key) {
        saved.setError('Nombre de producto no válido');
        return;
      }
      const ultimo = await saved.loadUltimo(key);
      if (!ultimo) {
        saved.setError('No se encontró un cálculo guardado para este producto');
        return;
      }
      const parsed = saved.applyCalculoToInputs(ultimo);
      if (!parsed) {
        saved.setError(
          'Los datos guardados están incompletos o dañados y no se pudieron cargar. Revisa el registro o guarda una versión nueva.',
        );
        return;
      }
      calc.replaceInputs(parsed);
      setSaveSearch(parsed.productDisplayName || productKey);
      setSelectedVersionId(ultimo.id);
      await saved.loadHistorico(key);
      setMixFunnelLevel('gen');
      setScreen('calculadora');
    },
    [calc, saved],
  );

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
        maxWidth: 1320,
        margin: '0 auto',
      }}
    >
      <PageHeader
        title="Calculadora COD"
        subtitle={
          screen === 'lista'
            ? 'Elige un producto guardado o inicia un cálculo nuevo'
            : 'Rentabilidad dropshipping · Pago contra entrega'
        }
        right={
          screen === 'calculadora' ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{(['COP', 'USD', 'MXN'] as const).map(currencyCtl)}</div>
          ) : undefined
        }
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

      {screen === 'lista' ? (
        <ProductosGuardadosList
          productos={saved.productos}
          loading={listBootstrapping && saved.productos.length === 0}
          busy={saved.loading}
          onVer={(key) => void abrirProductoGuardado(key)}
          onNuevoCalculo={abrirNuevoCalculo}
        />
      ) : (
        <>
          <button
            type="button"
            onClick={volverALista}
            disabled={saved.loading}
            style={{
              marginBottom: 14,
              padding: '8px 14px',
              borderRadius: 10,
              border: `1px solid ${ds.borderCard}`,
              background: 'var(--color-bg-card)',
              color: 'var(--color-text-secondary)',
              fontWeight: 700,
              fontSize: 12,
              cursor: saved.loading ? 'wait' : 'pointer',
            }}
          >
            ← Volver a la lista
          </button>

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

          <div style={{ marginTop: 22 }}>
            <PacksSummary currency={calc.inputs.currency} inputs={calc.inputs} packKpis={calc.packKpis} bestPackId={calc.bestId} />
          </div>

          <div style={{ marginTop: 22 }}>
            <SensitivitySection inputs={calc.inputs} packKpis={calc.packKpis} />
          </div>

          <div style={{ marginTop: 22 }}>
            <PygStatement inputs={calc.inputs} packKpis={calc.packKpis} mixFunnelLevel={mixFunnelLevel} />
          </div>

          <div style={{ marginTop: 22 }}>
            <MixCalculator
              inputs={calc.inputs}
              packKpis={calc.packKpis}
              onMixChange={calc.setMixPct}
              mixFunnelLevel={mixFunnelLevel}
              onMixFunnelLevelChange={setMixFunnelLevel}
            />
          </div>
        </>
      )}

      <style>{`
        .calc-cod-main-grid {
          display: block;
          width: 100%;
        }
      `}</style>
    </div>
  );
}
