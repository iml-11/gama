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

/**
 * Categorical series colours (fixed order, validated for colour-vision
 * deficiency on line charts; separate steps for the dark surface).
 */
export const SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

export function seriesStyle(i: number, dark: boolean): { color: string; dash: "solid"; width: number } {
  const p = dark ? SERIES.dark : SERIES.light;
  return { color: p[i % p.length], dash: "solid", width: 2 };
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
