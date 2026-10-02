import { cn } from "@/lib/utils";

/** Render a chemical formula with subscripts: Bi2WO6 -> Bi₂WO₆. */
export function Formula({ text, className, repeat }: { text: string; className?: string; repeat?: boolean }) {
  const parts = text.split(/(\d+(?:\.\d+)?)/g).filter(Boolean);
  return (
    <span className={cn("font-medium", className)}>
      {repeat && "("}
      {parts.map((p, i) => (/^\d/.test(p) && i > 0 ? <sub key={i} className="text-[0.72em]">{p}</sub> : <span key={i}>{p}</span>))}
      {repeat && (
        <>
          )<sub className="text-[0.72em] italic">n</sub>
        </>
      )}
    </span>
  );
}

/** Text that may contain a formula-like token: render formula tokens with subscripts. */
export function MaybeFormula({ text, className }: { text: string; className?: string }) {
  if (/^[A-Z][A-Za-z0-9().·\[\]]*$/.test(text) && /\d/.test(text)) return <Formula text={text} className={className} />;
  return <span className={className}>{text}</span>;
}
