"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Search, Loader2, Database, FlaskConical, Layers, Globe } from "lucide-react";
import { api, getOnline } from "@/lib/api";
import type { SearchResult } from "@/lib/types";
import { Formula } from "@/components/formula";
import { cn } from "@/lib/utils";

const KIND_ICON = {
  material: Database,
  family: Layers,
  pubchem: Globe,
  pubchem_cache: FlaskConical,
} as const;

export function MaterialInput({
  value,
  onChange,
  size = "lg",
  placeholder = "Material, formula or composite — e.g. Bi2WO6, PMMA, 60 wt% Bi2WO6 + 40 wt% epoxy",
  loading,
  autoFocus,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  size?: "lg" | "sm";
  placeholder?: string;
  loading?: boolean;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const listId = useId();
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;
  const typed = useRef(false);

  // Autocomplete on the last composite term ("60 wt% Bi2WO6 + 40 wt% ep" -> "ep").
  const term = value.split(/\+|\//).pop()!.replace(/^\s*\d+(\.\d+)?\s*(wt|vol)?\.?\s*%\s*/i, "").trim();

  useEffect(() => {
    if (!typed.current || term.length < 1) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api
        .search(term, getOnline() && term.length >= 3, ctrl.signal)
        .then((r) => {
          setItems(r.results);
          setActive(0);
        })
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [term]);

  const pick = (it: SearchResult) => {
    const prefix = value.slice(0, value.length - value.split(/\+|\//).pop()!.length);
    const lastRaw = value.split(/\+|\//).pop()!;
    const frac = lastRaw.match(/^\s*\d+(\.\d+)?\s*(wt|vol)?\.?\s*%\s*/i)?.[0] ?? "";
    const name = it.type === "material" && it.formula && /^[A-Z]/.test(it.match) && it.match === it.formula ? it.formula : it.name;
    onChange(prefix + (prefix ? (prefix.endsWith(" ") ? "" : " ") : "") + frac + name);
    typed.current = false;
    setOpen(false);
    ref.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + items.length) % items.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (items[active] && typed.current) {
        e.preventDefault();
        pick(items[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && items.length > 0 && typed.current;

  return (
    <div className="relative">
      <div className="relative">
        <Search className={cn("pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground", size === "lg" ? "size-5" : "size-4")} />
        <input
          ref={ref}
          value={value}
          autoFocus={autoFocus}
          role="combobox"
          aria-label="Material"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          spellCheck={false}
          autoComplete="off"
          placeholder={placeholder}
          onChange={(e) => {
            typed.current = true;
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
          className={cn(
            "w-full rounded-lg border border-input bg-card shadow-xs outline-none transition-[box-shadow,border-color] placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35",
            size === "lg" ? "h-14 pr-11 pl-11 text-lg" : "h-9 pr-9 pl-9 text-sm"
          )}
        />
        {loading && <Loader2 className="absolute top-1/2 right-3.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1.5 max-h-80 w-full overflow-auto rounded-lg border bg-popover p-1 shadow-lg"
        >
          {items.map((it, i) => {
            const Icon = KIND_ICON[it.type] ?? Database;
            return (
              <li
                key={it.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(it);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn("flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm", i === active && "bg-accent")}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    {it.name}
                    {it.match && it.match.toLowerCase() !== it.name.toLowerCase() && it.match !== it.formula && (
                      <span className="ml-1.5 text-xs text-muted-foreground">({it.match})</span>
                    )}
                  </div>
                </div>
                {it.formula && (
                  <span className="text-xs text-muted-foreground">
                    <Formula text={it.formula} repeat={it.repeat_unit} className="font-normal" />
                  </span>
                )}
                <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">
                  {it.type === "family" ? "presets" : it.type === "pubchem" ? "PubChem" : it.category}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
