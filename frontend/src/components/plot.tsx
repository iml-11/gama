"use client";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import type { Config, Data, Layout } from "plotly.js";

const PlotImpl = dynamic(
  async () => {
    const Plotly = (await import("plotly.js-basic-dist-min")).default;
    const createPlotlyComponent = (await import("react-plotly.js/factory")).default;
    return createPlotlyComponent(Plotly);
  },
  { ssr: false, loading: () => <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading chart…</div> }
);

/** Monochrome series: distinguished by grey level and dash pattern, not by hue. */
const DASHES = ["solid", "dash", "dot", "dashdot", "longdash", "longdashdot"] as const;
export function seriesStyle(i: number, dark: boolean): { color: string; dash: (typeof DASHES)[number]; width: number } {
  const shades = dark ? ["#fafafa", "#a1a1aa", "#71717a"] : ["#18181b", "#71717a", "#a1a1aa"];
  // Grey level and dash pattern both change from one series to the next.
  return { color: shades[i % shades.length], dash: DASHES[i % DASHES.length], width: i >= DASHES.length ? 2.8 : i === 0 ? 2.2 : 1.7 };
}

export function useDark() {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark";
}

/** Plotly wrapper with theme-aware defaults. */
export function Plot({ data, layout, className, config }: { data: Data[]; layout?: Partial<Layout>; config?: Partial<Config>; className?: string }) {
  const dark = useDark();
  const fg = dark ? "#d4d4d8" : "#3f3f46";
  const grid = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)";
  const axis = { gridcolor: grid, zerolinecolor: grid, linecolor: grid, color: fg };
  return (
    <div className={className}>
      <PlotImpl
        data={data}
        layout={{
          autosize: true,
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(0,0,0,0)",
          font: { family: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif", size: 11.5, color: fg },
          hoverlabel: { bgcolor: dark ? "#18181b" : "#ffffff", bordercolor: dark ? "#3f3f46" : "#e4e4e7", font: { color: dark ? "#fafafa" : "#18181b" } },
          margin: { l: 64, r: 16, t: 16, b: 48 },
          legend: { orientation: "h", y: -0.2, font: { size: 11 } },
          hovermode: "x unified",
          ...layout,
          xaxis: { ...axis, ...(layout?.xaxis ?? {}) },
          yaxis: { ...axis, ...(layout?.yaxis ?? {}) },
        }}
        config={{ displaylogo: false, responsive: true, modeBarButtonsToRemove: ["select2d", "lasso2d"], ...config }}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
