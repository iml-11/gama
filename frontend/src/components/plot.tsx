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

export const CHART_COLORS = ["#4f6bed", "#e2703a", "#2e9e6a", "#a35bd1", "#d9a21b", "#d6457a", "#3aa6c9", "#6b7280"];

/** Plotly wrapper with theme-aware defaults. */
export function Plot({ data, layout, className, config }: { data: Data[]; layout?: Partial<Layout>; config?: Partial<Config>; className?: string }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const fg = dark ? "#d8dce6" : "#2a2f3a";
  const grid = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";
  const axis = { gridcolor: grid, zerolinecolor: grid, linecolor: grid, color: fg };
  return (
    <div className={className}>
      <PlotImpl
        data={data}
        layout={{
          autosize: true,
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(0,0,0,0)",
          font: { family: "ui-sans-serif, system-ui, sans-serif", size: 12, color: fg },
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
