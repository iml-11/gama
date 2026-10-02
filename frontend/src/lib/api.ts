import type {
  CalculateResponse,
  EnergyUnit,
  Isotope,
  LengthUnit,
  MaterialInputState,
  MaterialSummary,
  Family,
  Resolution,
  SearchResult,
  SpectrumData,
} from "./types";

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "The scientific engine (backend) is not reachable.");
  }
  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* ignore */
    }
    let msg = `Request failed (${res.status})`;
    if (typeof detail === "string") msg = detail;
    else if (detail && typeof detail === "object" && "message" in detail) msg = String((detail as { message: string }).message);
    else if (Array.isArray(detail)) msg = detail.map((d: { msg?: string }) => d.msg).join("; ");
    if (res.status === 500 || res.status === 502 || res.status === 504) msg = "The scientific engine (backend) is not reachable.";
    throw new ApiError(res.status, msg, detail);
  }
  return res.json() as Promise<T>;
}

export const getOnline = () => {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem("gamma.online") !== "0";
  } catch {
    return true;
  }
};

function materialBody(m: MaterialInputState) {
  return { input: m.input, choices: m.choices, composition: m.composition ?? null, online: getOnline() };
}

export const api = {
  meta: () =>
    request<{ engine_configured: boolean; online_lookup: boolean; xcom: { name: string; doi: string } | null; isotopes: { source: string; reference: string; notes: string[] } }>(
      "/api/meta"
    ),
  search: (q: string, online: boolean, signal?: AbortSignal) =>
    request<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}&online=${online}&limit=10`, { signal }),
  resolve: (m: MaterialInputState, signal?: AbortSignal) =>
    request<Resolution>("/api/resolve", { method: "POST", body: JSON.stringify(materialBody(m)), signal }),
  calculate: (body: {
    material: MaterialInputState;
    energies: { value: number; unit: EnergyUnit; label?: string }[];
    density?: { value: number; source: "database" | "user" | "estimate" } | null;
    thickness?: { value: number; unit: LengthUnit } | null;
  }) =>
    request<CalculateResponse>("/api/calculate", {
      method: "POST",
      body: JSON.stringify({ ...body, material: materialBody(body.material) }),
    }),
  spectrum: (material: MaterialInputState, eMin: { value: number; unit: EnergyUnit }, eMax: { value: number; unit: EnergyUnit }, points = 300) =>
    request<SpectrumData & { material: Resolution }>("/api/spectrum", {
      method: "POST",
      body: JSON.stringify({ material: materialBody(material), e_min: eMin, e_max: eMax, points }),
    }),
  table: (body: {
    material: MaterialInputState;
    e_min?: { value: number; unit: EnergyUnit };
    e_max?: { value: number; unit: EnergyUnit };
    energies?: { value: number; unit: EnergyUnit }[];
    density?: { value: number; source: "database" | "user" | "estimate" } | null;
    thickness?: { value: number; unit: LengthUnit } | null;
  }) =>
    request<{ material: Resolution; density: { value: number } | null; rows: (CalculateResponse["results"][number] & { edge: string | null })[] }>(
      "/api/table",
      { method: "POST", body: JSON.stringify({ ...body, material: materialBody(body.material) }) }
    ),
  compare: (body: {
    items: { material: MaterialInputState; density?: { value: number; source: string } | null; label?: string }[];
    energies: { value: number; unit: EnergyUnit }[];
    e_min?: { value: number; unit: EnergyUnit };
    e_max?: { value: number; unit: EnergyUnit };
    thickness?: { value: number; unit: LengthUnit } | null;
  }) =>
    request<{
      items: {
        label: string;
        material: Resolution;
        density: { value: number; source: string; label: string } | null;
        at_energies: CalculateResponse["results"];
        spectrum?: SpectrumData;
      }[];
      linear_comparable: boolean;
      note: string | null;
    }>("/api/compare", {
      method: "POST",
      body: JSON.stringify({ ...body, items: body.items.map((i) => ({ ...i, material: materialBody(i.material) })) }),
    }),
  experimental: (body: {
    material: MaterialInputState;
    energy_unit: EnergyUnit;
    density?: { value: number; source: string } | null;
    points: { energy: number; mu?: number | null; mu_rho?: number | null; uncertainty?: number | null }[];
  }) =>
    request<{
      material: Resolution;
      density: { value: number } | null;
      points: {
        energy: number;
        energy_MeV: number;
        xcom_mu_rho: number | null;
        xcom_mu: number | null;
        exp_mu_rho: number | null;
        exp_mu: number | null;
        exp_mu_rho_derived_from_mu: boolean;
        uncertainty: number | null;
        percent_difference: number | null;
        relative_error: number | null;
      }[];
      summary: { n: number; mean_percent_difference: number; mean_absolute_percent_difference: number; rms_percent_difference: number } | null;
    }>("/api/experimental", { method: "POST", body: JSON.stringify({ ...body, material: materialBody(body.material) }) }),
  isotopes: () => request<{ isotopes: Isotope[]; dataset: { source: string; reference: string; notes: string[] } }>("/api/isotopes"),
  materials: () => request<{ materials: MaterialSummary[]; families: Family[] }>("/api/materials"),
  material: (id: string) => request<MaterialSummary>(`/api/materials/${encodeURIComponent(id)}`),
  customMaterials: () => request<{ materials: MaterialSummary[] }>("/api/custom-materials"),
  createCustom: (body: {
    name: string;
    mode: "formula" | "elements";
    formula?: string;
    mass_percent?: Record<string, number>;
    density?: number | null;
    notes?: string;
    reference?: string | null;
  }) => request<MaterialSummary>("/api/custom-materials", { method: "POST", body: JSON.stringify(body) }),
  deleteCustom: (id: string) => request<{ deleted: string }>(`/api/custom-materials/${encodeURIComponent(id)}`, { method: "DELETE" }),
  references: () =>
    request<{ references: { topic: string; items: { id: string; citation: string; doi?: string; url?: string; used_for: string }[] }[] }>(
      "/api/references"
    ),
};
