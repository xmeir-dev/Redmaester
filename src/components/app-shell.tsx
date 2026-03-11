import { cn } from "@/lib/utils";
import { CodeRainBg } from "./code-rain-bg";

export function AppShell({
  children,
  header,
}: {
  children: React.ReactNode;
  header?: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen bg-[hsl(var(--background))]">
      <CodeRainBg />
      {header ? (
        <header className="sticky top-0 z-10 border-b border-[hsl(var(--border))] bg-[hsl(var(--gray-2))]">
          {header}
        </header>
      ) : null}
      <main className="relative z-[1] mx-auto max-w-screen-xl px-8 py-10">{children}</main>
    </div>
  );
}

export function AppShellSection({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <section className={cn("mt-8 first:mt-0", className)}>{children}</section>;
}
