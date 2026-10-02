export type EnergyUnit = "eV" | "keV" | "MeV" | "GeV";
export type LengthUnit = "um" | "mm" | "cm" | "m";

export interface ElementFraction {
  symbol: string;
  Z: number;
  name: string;
  mass_fraction: number;
  atom_count: number | null;
  atomic_weight: number;
}

export interface CompositionData {
  formula: string | null;
  molar_mass: number | null;
  elements: ElementFraction[];
  notes: string[];
}

export interface DensityInfo {
  value: number | null;
  source: string;
  kind: "database" | "user" | "estimate";
}

export interface Provenance {
  item: string;
  source: string;
  url?: string;
}

export interface MaterialSummary {
  id: string;
  name: string;
  category: string;
  source_kind: string;
  formula: string | null;
  repeat_unit: boolean;
  aliases: string[];
  density: DensityInfo | null;
  composition_source: string;
  notes: string;
  confidence: string;
  family: string | null;
  reference: string | null;
  composition?: CompositionData | null;
}

export interface Family {
  id: string;
  name: string;
  aliases: string[];
  warning: string;
  templates: string[];
  presets: MaterialSummary[];
}

export interface Component {
  text: string;
  percent: number;
  mass_percent?: number;
  basis: "wt" | "vol";
  role: string | null;
  resolution: Resolution;
}

export interface Resolution {
  input: string;
  status: "resolved" | "needs_choice" | "not_found" | "error";
  kind: string | null;
  name: string | null;
  category: string | null;
  formula: string | null;
  repeat_unit: boolean;
  composition: CompositionData | null;
  density: DensityInfo | null;
  density_estimate: DensityInfo | null;
  material: MaterialSummary | null;
  pubchem: {
    cid: number;
    title: string;
    formula: string;
    molecular_weight: number | null;
    synonyms: string[];
    retrieved: string;
    url: string;
    from_cache?: boolean;
  } | null;
  components: Component[];
  family: Family | null;
  alternatives: { label: string; input: string; kind: string }[];
  suggestions: SearchResult[];
  provenance: Provenance[];
  warnings: string[];
  errors: string[];
  steps: string[];
}

export interface SearchResult {
  type: "material" | "family" | "pubchem" | "pubchem_cache";
  id: string;
  name: string;
  category: string;
  formula?: string | null;
  repeat_unit?: boolean;
  source_kind?: string;
  density?: number | null;
  match: string;
}

export interface MassAttenuation {
  coherent: number | null;
  incoherent: number | null;
  photoelectric: number | null;
  pair_nuclear: number | null;
  pair_electron: number | null;
  pair_total: number | null;
  total_with_coherent: number | null;
  total_without_coherent: number | null;
}

export interface ShieldingData {
  density_g_cm3: number;
  mu_cm_inv: number;
  mfp_cm: number;
  hvl_cm: number;
  tvl_cm: number;
  thickness_cm: number | null;
  transmission: number | null;
  shielding_efficiency_percent: number | null;
}

export interface ResultRow {
  energy_MeV: number;
  energy_input?: { value: number; unit: EnergyUnit; label?: string | null };
  mass_attenuation: MassAttenuation;
  available: boolean;
  unavailable_reason: string | null;
  shielding: ShieldingData | null;
  shielding_without_coherent: ShieldingData | null;
}

export interface CalculationDetails {
  dataset: { name: string; authors: string; url: string; doi: string; conversion: string; source_sha256: string };
  interpolation: string;
  atomic_weights_composition: { source: string; reference: string; distribution: string };
  atomic_weights_xcom: string;
  avogadro: number;
  equations: { name: string; latex: string; text: string }[];
  geometry: string;
}

export interface CalculateResponse {
  material: Resolution;
  density: { value: number; source: string; label: string } | null;
  thickness: { value: number; unit: LengthUnit; cm: number } | null;
  results: ResultRow[];
  density_dependent_enabled: boolean;
  details: CalculationDetails;
}

export interface Edge {
  element: string;
  label: string;
  energy_MeV: number;
}

export interface SpectrumData {
  energy_MeV: number[];
  mass_attenuation: Record<keyof MassAttenuation, (number | null)[]>;
  edges: Edge[];
  unavailable: { element: string; edge: string; from_MeV: number; to_MeV: number }[];
}

export interface GammaLine {
  emitter: string;
  energy_keV: number;
  energy_unc_keV: number;
  intensity_percent: number;
}

export interface Isotope {
  id: string;
  emitters: string[];
  half_life_s: number;
  lines: GammaLine[];
}

export interface MaterialInputState {
  input: string;
  choices: Record<string, string>;
  composition?: Record<string, number> | null;
}
