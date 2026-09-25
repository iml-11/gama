"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Formula } from "@/components/formula";
import { api, ApiError } from "@/lib/api";
import type { Family, MaterialSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

const GROUPS: { key: string; label: string; match: (m: MaterialSummary) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "polymer", label: "Polymers", match: (m) => m.category === "polymer" },
  { key: "presets", label: "Presets", match: (m) => m.source_kind === "preset" },
  { key: "inorganic", label: "Compounds", match: (m) => m.category === "inorganic" },
  { key: "nist", label: "NIST materials", match: (m) => m.source_kind === "nist_estar" },
  { key: "element", label: "Elements", match: (m) => m.category === "element" },
  { key: "custom", label: "Custom", match: (m) => m.source_kind === "custom" },
];

export function MaterialsBrowser() {
  const params = useSearchParams();
  const [materials, setMaterials] = useState<MaterialSummary[]>([]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const [selected, setSelected] = useState<MaterialSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .materials()
      .then((r) => {
        setMaterials(r.materials);
        setFamilies(r.families);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const g = GROUPS.find((x) => x.key === group)!;
    const ql = q.trim().toLowerCase();
    return materials.filter(
      (m) => g.match(m) && (!ql || m.name.toLowerCase().includes(ql) || m.aliases.some((a) => a.toLowerCase().includes(ql)) || (m.formula ?? "").toLowerCase().includes(ql))
    );
  }, [materials, q, group]);

  const openDetail = (m: MaterialSummary) => api.material(m.id).then(setSelected).catch(() => setSelected(m));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Material database</h1>
        <p className="text-sm text-muted-foreground">
          Curated polymers and presets, NIST ESTAR reference materials, elements and your custom materials. Every entry lists the source of its composition and density.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Card>
          <CardHeader className="gap-3">
            <div className="relative">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Filter by name, alias or formula" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {GROUPS.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setGroup(g.key)}
                  className={cn("rounded-md border px-2 py-1 text-xs", group === g.key ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-accent/50")}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {(group === "all" || group === "presets") && !q && (
              <div className="mb-4 space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">Ambiguous material families (require a preset)</div>
                <div className="flex flex-wrap gap-1.5">
                  {families.map((f) => (
                    <Badge key={f.id} variant="warning">
                      {f.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div className="max-h-[560px] divide-y overflow-auto rounded-lg border">
              {filtered.length === 0 && <div className="p-4 text-sm text-muted-foreground">No materials.</div>}
              {filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => openDetail(m)}
                  className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent/40", selected?.id === m.id && "bg-accent/60")}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{m.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{m.aliases.slice(0, 4).join(" · ")}</div>
                  </div>
                  {m.formula && (
                    <span className="text-xs text-muted-foreground">
                      <Formula text={m.formula} repeat={m.repeat_unit} className="font-normal" />
                    </span>
                  )}
                  <span className="w-20 text-right text-xs text-muted-foreground mono-num">{m.density?.value ? `${m.density.value} g/cm³` : "—"}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{filtered.length} entries</p>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {selected && <MaterialDetail m={selected} onDeleted={() => { setSelected(null); load(); }} />}
          <CustomCreator initialName={params.get("new") ?? ""} onCreated={(m) => { load(); setSelected(m); }} />
        </div>
      </div>
    </div>
  );
}

function MaterialDetail({ m, onDeleted }: { m: MaterialSummary; onDeleted: () => void }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{m.name}</CardTitle>
            <CardDescription>{m.aliases.join(" · ")}</CardDescription>
          </div>
          <Badge variant="secondary">{m.source_kind.replace("_", " ")}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {m.formula && (
          <div>
            <span className="text-muted-foreground">{m.repeat_unit ? "Repeat unit: " : "Formula: "}</span>
            <Formula text={m.formula} repeat={m.repeat_unit} />
          </div>
        )}
        {m.composition && (
          <div className="flex flex-wrap gap-1 text-xs mono-num">
            {m.composition.elements.map((e) => (
              <span key={e.symbol} className="rounded bg-muted px-1.5 py-0.5">
                {e.symbol} {(e.mass_fraction * 100).toFixed(3)}%
              </span>
            ))}
          </div>
        )}
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Composition</dt>
          <dd>{m.composition_source}</dd>
          <dt className="text-muted-foreground">Density</dt>
          <dd>{m.density?.value ? `${m.density.value} g/cm³ — ${m.density.source}` : "Not in database (user value required)"}</dd>
          <dt className="text-muted-foreground">Confidence</dt>
          <dd>{m.confidence}</dd>
          {m.reference && (
            <>
              <dt className="text-muted-foreground">Reference</dt>
              <dd>{m.reference}</dd>
            </>
          )}
          {m.notes && (
            <>
              <dt className="text-muted-foreground">Notes</dt>
              <dd>{m.notes}</dd>
            </>
          )}
        </dl>
        {m.source_kind === "custom" && (
          <Button variant="outline" size="sm" onClick={() => api.deleteCustom(m.id).then(onDeleted)}>
            <Trash2 /> Delete custom material
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function CustomCreator({ initialName, onCreated }: { initialName: string; onCreated: (m: MaterialSummary) => void }) {
  const [mode, setMode] = useState<"formula" | "elements">("formula");
  const [name, setName] = useState(initialName);
  const [formula, setFormula] = useState("");
  const [rows, setRows] = useState([
    { symbol: "C", pct: "" },
    { symbol: "H", pct: "" },
    { symbol: "O", pct: "" },
  ]);
  const [density, setDensity] = useState("");
  const [notes, setNotes] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const total = rows.reduce((s, r) => s + (parseFloat(r.pct) || 0), 0);
  const sumOk = Math.abs(total - 100) <= 0.5;

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const d = parseFloat(density);
      const m = await api.createCustom({
        name,
        mode,
        formula: mode === "formula" ? formula : undefined,
        mass_percent: mode === "elements" ? Object.fromEntries(rows.filter((r) => r.symbol).map((r) => [r.symbol, parseFloat(r.pct) || 0])) : undefined,
        density: Number.isFinite(d) && d > 0 ? d : null,
        notes,
        reference: reference || null,
      });
      setMsg({ ok: true, text: `Saved “${m.name}”. You can now type it in the calculator.` });
      onCreated(m);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="custom">
      <CardHeader>
        <CardTitle>Create custom material</CardTitle>
        <CardDescription>Saved on the server in backend/data/user/custom_materials.json.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="cm-name">Name</Label>
          <Input id="cm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My epoxy formulation" />
        </div>
        <Tabs value={mode} onValueChange={(v) => setMode(v as "formula" | "elements")}>
          <TabsList>
            <TabsTrigger value="formula">Formula</TabsTrigger>
            <TabsTrigger value="elements">Elemental wt%</TabsTrigger>
          </TabsList>
          <TabsContent value="formula" className="space-y-1.5">
            <Input value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="C10H8O4 or (C5H8O2)n" aria-label="Formula" />
            {formula && <p className="text-xs text-muted-foreground">Preview: <Formula text={formula} className="font-normal" /></p>}
          </TabsContent>
          <TabsContent value="elements" className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input className="w-20" value={r.symbol} aria-label="Element" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, symbol: e.target.value.trim() } : x)))} />
                <Input
                  className="w-28 text-right mono-num"
                  inputMode="decimal"
                  value={r.pct}
                  aria-label="wt%"
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))}
                />
                <span className="text-xs text-muted-foreground">wt%</span>
                <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setRows([...rows, { symbol: "", pct: "" }])}>
                <Plus /> Element
              </Button>
              <span className={cn("text-sm mono-num", sumOk ? "text-success" : "text-destructive")}>
                Total {total.toFixed(2)} % {sumOk && <Check className="inline size-3.5" />}
              </span>
            </div>
            {!sumOk && <p className="text-xs text-muted-foreground">Weight fractions must sum to 100 % (±0.5 %).</p>}
          </TabsContent>
        </Tabs>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cm-d">Density (g/cm³, optional)</Label>
            <Input id="cm-d" inputMode="decimal" value={density} onChange={(e) => setDensity(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cm-r">Reference (optional)</Label>
            <Input id="cm-r" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Datasheet, paper, measurement" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cm-n">Notes</Label>
          <Textarea id="cm-n" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <Button disabled={busy || !name.trim() || (mode === "formula" ? !formula.trim() : !sumOk)} onClick={submit}>
          {busy ? <Loader2 className="animate-spin" /> : <Plus />} Save material
        </Button>
        {msg && <p className={cn("text-sm", msg.ok ? "text-success" : "text-destructive")}>{msg.text}</p>}
      </CardContent>
    </Card>
  );
}
