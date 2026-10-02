import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
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
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen font-sans">
        <ThemeProvider>
          <TooltipProvider delayDuration={200}>
            <SiteHeader />
            <EngineStatus />
            <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">{children}</main>
            <footer className="border-t">
              <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-2 px-4 py-6 text-xs text-muted-foreground sm:px-6">
                <span>Photon cross sections: NIST XCOM (NIST SRD 8). Narrow-beam attenuation, no build-up.</span>
                <span>All data sources are listed under References.</span>
              </div>
            </footer>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
