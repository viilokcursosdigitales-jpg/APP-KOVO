/* eslint-disable react-refresh/only-export-components --
   Provider, hook y tipos en un solo archivo para aislar persistencia (migración API/Supabase). */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { etiquetaMesAnio, type PlanVentas, type ProductoPlan } from '../types/planVentas';
import { diasEnMes } from '../utils/calculosVentas';

const STORAGE_KEY = 'kovo_planes_ventas';

function nowIso(): string {
  return new Date().toISOString();
}

function nuevoId(): string {
  return crypto.randomUUID();
}

function productosPrecarga(): ProductoPlan[] {
  return [
    {
      id: nuevoId(),
      nombre: 'Body de hinchas',
      precioVenta: 69900,
      margenBrutoPct: 40,
      tasaConfirmacion: 20,
      tasaEntrega: 80,
      distribucionVentas: 50,
    },
    {
      id: nuevoId(),
      nombre: 'Producto 2',
      precioVenta: 59900,
      margenBrutoPct: 35,
      tasaConfirmacion: 25,
      tasaEntrega: 80,
      distribucionVentas: 30,
    },
    {
      id: nuevoId(),
      nombre: 'Producto 3',
      precioVenta: 49900,
      margenBrutoPct: 27,
      tasaConfirmacion: 25,
      tasaEntrega: 80,
      distribucionVentas: 20,
    },
  ];
}

function planDesdeCero(mes: number, anio: number): PlanVentas {
  const t = nowIso();
  return {
    id: nuevoId(),
    mes,
    anio,
    nombre: etiquetaMesAnio(mes, anio),
    creadoEn: t,
    actualizadoEn: t,
    meta: 10_000_000,
    tipoMeta: 'utilidad',
    gastosAdminPct: 4,
    presupuestoAds: 3_000_000,
    productos: productosPrecarga(),
    notas: '',
    diasCalculo: diasEnMes(mes, anio),
  };
}

function clonarProductosConNuevosIds(productos: ProductoPlan[]): ProductoPlan[] {
  return productos.map((p) => ({ ...p, id: nuevoId() }));
}

function ordenarPlanes(planes: PlanVentas[]): PlanVentas[] {
  return [...planes].sort((a, b) => {
    const ta = new Date(a.actualizadoEn || a.creadoEn).getTime();
    const tb = new Date(b.actualizadoEn || b.creadoEn).getTime();
    return tb - ta;
  });
}

// ——————————————————————————————————————————————————————————————
// Persistencia: TODO el I/O vive aquí. Al migrar a API/Supabase, solo
// reemplaza los cuerpos de persistReadAll / persistWriteAll (mismas firmas async).
// ——————————————————————————————————————————————————————————————

async function persistReadAll(): Promise<PlanVentas[]> {
  await Promise.resolve();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as PlanVentas[];
  } catch {
    return [];
  }
}

async function persistWriteAll(planes: PlanVentas[]): Promise<void> {
  await Promise.resolve();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(planes));
}

export type CrearPlanOpciones = {
  /** Si se indica, copia datos del plan origen (productos, meta, etc.) salvo mes/año/nombre/ids. */
  duplicarDesdeId?: string | null;
};

export type PlanesVentasApi = {
  planes: PlanVentas[];
  cargando: boolean;
  /** Recarga desde la capa de persistencia (útil tras otra pestaña). */
  refrescar: () => Promise<void>;
  obtenerPlan: (id: string) => Promise<PlanVentas | null>;
  existePlanEnMesAnio: (mes: number, anio: number, excluirPlanId?: string) => Promise<boolean>;
  crearPlan: (mes: number, anio: number, opciones?: CrearPlanOpciones) => Promise<PlanVentas>;
  /** Devuelve el plan persistido (p. ej. con actualizadoEn fresco). */
  actualizarPlan: (id: string, data: Partial<PlanVentas>) => Promise<PlanVentas>;
  eliminarPlan: (id: string) => Promise<void>;
  duplicarPlan: (id: string, mesDestino: number, anioDestino: number) => Promise<PlanVentas>;
};

const PlanesVentasContext = createContext<PlanesVentasApi | null>(null);

function usePlanesVentasInternal(): PlanesVentasApi {
  const [planes, setPlanes] = useState<PlanVentas[]>([]);
  const [cargando, setCargando] = useState(true);

  const refrescar = useCallback(async () => {
    setCargando(true);
    try {
      const list = ordenarPlanes(await persistReadAll());
      setPlanes(list);
    } finally {
      setCargando(false);
    }
  }, []);

  const obtenerPlan = useCallback(async (id: string) => {
    const list = await persistReadAll();
    return list.find((p) => p.id === id) ?? null;
  }, []);

  const existePlanEnMesAnio = useCallback(
    async (mes: number, anio: number, excluirPlanId?: string) => {
      const list = await persistReadAll();
      return list.some((p) => p.mes === mes && p.anio === anio && p.id !== excluirPlanId);
    },
    [],
  );

  useEffect(() => {
    void refrescar();
  }, [refrescar]);

  const crearPlan = useCallback(async (mes: number, anio: number, opciones?: CrearPlanOpciones) => {
    if (await existePlanEnMesAnio(mes, anio)) {
      throw new Error('Ya existe un plan para ese mes y año.');
    }
    const list = await persistReadAll();
    let nuevo: PlanVentas;

    if (opciones?.duplicarDesdeId) {
      const origen = list.find((p) => p.id === opciones.duplicarDesdeId);
      if (!origen) throw new Error('No se encontró el plan a duplicar.');
      const t = nowIso();
      const diasMesDestino = diasEnMes(mes, anio);
      const rawDias = origen.diasCalculo;
      const diasClamped =
        rawDias != null && Number.isFinite(Number(rawDias)) && Number(rawDias) > 0
          ? Math.min(Math.max(1, Math.round(Number(rawDias))), diasMesDestino)
          : diasMesDestino;
      nuevo = {
        ...origen,
        id: nuevoId(),
        mes,
        anio,
        nombre: etiquetaMesAnio(mes, anio),
        creadoEn: t,
        actualizadoEn: t,
        productos: clonarProductosConNuevosIds(origen.productos),
        diasCalculo: diasClamped,
      };
    } else {
      nuevo = planDesdeCero(mes, anio);
    }

    const next = ordenarPlanes([...list, nuevo]);
    await persistWriteAll(next);
    setPlanes(next);
    return nuevo;
  }, [existePlanEnMesAnio]);

  const actualizarPlan = useCallback(async (id: string, data: Partial<PlanVentas>) => {
    const list = await persistReadAll();
    const idx = list.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error('Plan no encontrado.');
    const prev = list[idx];
    const nextMes = data.mes !== undefined ? data.mes : prev.mes;
    const nextAnio = data.anio !== undefined ? data.anio : prev.anio;
    if (nextMes !== prev.mes || nextAnio !== prev.anio) {
      const ocupado = list.some((p) => p.mes === nextMes && p.anio === nextAnio && p.id !== id);
      if (ocupado) throw new Error('Ya existe otro plan para ese mes y año.');
    }
    const actualizadoEn = nowIso();
    const merged: PlanVentas = {
      ...prev,
      ...data,
      id: prev.id,
      creadoEn: prev.creadoEn,
      actualizadoEn,
    };
    const dm = diasEnMes(merged.mes, merged.anio);
    const rawDc = merged.diasCalculo;
    merged.diasCalculo =
      rawDc != null && Number.isFinite(Number(rawDc)) && Number(rawDc) > 0
        ? Math.min(Math.max(1, Math.round(Number(rawDc))), dm)
        : dm;
    const nextList = [...list];
    nextList[idx] = merged;
    const next = ordenarPlanes(nextList);
    await persistWriteAll(next);
    setPlanes(next);
    return merged;
  }, []);

  const eliminarPlan = useCallback(async (id: string) => {
    const list = await persistReadAll();
    const next = ordenarPlanes(list.filter((p) => p.id !== id));
    await persistWriteAll(next);
    setPlanes(next);
  }, []);

  const duplicarPlan = useCallback(
    async (id: string, mesDestino: number, anioDestino: number) => {
      return crearPlan(mesDestino, anioDestino, { duplicarDesdeId: id });
    },
    [crearPlan],
  );

  return useMemo(
    () => ({
      planes,
      cargando,
      refrescar,
      obtenerPlan,
      existePlanEnMesAnio,
      crearPlan,
      actualizarPlan,
      eliminarPlan,
      duplicarPlan,
    }),
    [
      planes,
      cargando,
      refrescar,
      obtenerPlan,
      existePlanEnMesAnio,
      crearPlan,
      actualizarPlan,
      eliminarPlan,
      duplicarPlan,
    ],
  );
}

/** Proveedor: montar en el layout del módulo para compartir estado entre lista y detalle. */
export function PlanesVentasProvider({ children }: { children: ReactNode }) {
  const api = usePlanesVentasInternal();
  return <PlanesVentasContext.Provider value={api}>{children}</PlanesVentasContext.Provider>;
}

export function usePlanesVentas(): PlanesVentasApi {
  const ctx = useContext(PlanesVentasContext);
  if (!ctx) {
    throw new Error('usePlanesVentas debe usarse dentro de PlanesVentasProvider.');
  }
  return ctx;
}
