"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Globe, GlobeLock, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Calculator" },
  { href: "/compare", label: "Compare" },
  { href: "/experimental", label: "Experimental" },
  { href: "/materials", label: "Materials" },
  { href: "/references", label: "References" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setMounted(true);
    try {
      setOnline(window.localStorage.getItem("gamma.online") !== "0");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggleOnline = () => {
    const next = !online;
    setOnline(next);
    try {
      window.localStorage.setItem("gamma.online", next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground text-base leading-none">γ</span>
          <span className="hidden sm:inline">Gamma Attenuation</span>
        </Link>
        <nav className="flex flex-1 items-center gap-0.5 overflow-x-auto text-sm">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "rounded-md px-2.5 py-1.5 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
                (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)) && "bg-muted text-foreground"
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={toggleOnline} aria-label="Toggle online lookups" className="text-muted-foreground">
              {online ? <Globe /> : <GlobeLock />}
              <span className="hidden md:inline">{online ? "Online" : "Offline"}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {online
              ? "Online mode: unknown chemical names are looked up in PubChem (results are cached locally)."
              : "Offline mode: only the local database, cache and formulas are used."}
          </TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle dark mode"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          {mounted && resolvedTheme === "dark" ? <Sun /> : <Moon />}
        </Button>
      </div>
    </header>
  );
}
