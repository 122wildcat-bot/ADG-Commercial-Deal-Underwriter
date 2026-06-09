import { ReactNode, useState } from "react";
import { ChevronDown } from "lucide-react";

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function Section({ title, subtitle, children, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section-card mb-4">
      <button
        type="button"
        className="section-header w-full text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="text-xs text-[var(--muted-fg)]">{subtitle}</p>}
        </div>
        <ChevronDown
          className="h-4 w-4 text-[var(--muted-fg)] transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      {open && <div className="section-body pt-3">{children}</div>}
    </div>
  );
}
