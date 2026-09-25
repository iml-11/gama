import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { SiteHeader } from "@/components/site-header";
import { EngineStatus } from "@/components/engine-status";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "Gamma Attenuation",
  description: "Gamma-ray attenuation and shielding calculations from NIST XCOM data with automatic material composition.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans">
        <ThemeProvider>
          <TooltipProvider delayDuration={200}>
            <SiteHeader />
            <EngineStatus />
            <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
            <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-muted-foreground sm:px-6">
              Photon cross sections: NIST XCOM (Berger et al., NIST SRD 8). Narrow-beam attenuation, no build-up. See References for all data sources.
            </footer>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
