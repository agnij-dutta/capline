import { forwardRef } from "react";
import Link from "next/link";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-mono uppercase tracking-[0.08em] font-medium border-2 transition-[background-color,color,border-color] duration-[80ms] ease-[cubic-bezier(0.2,0,0,1)] disabled:opacity-40 disabled:pointer-events-none select-none whitespace-nowrap";

const sizes: Record<Size, string> = {
  sm: "text-[11px] px-3 py-1.5",
  md: "text-xs px-5 py-3",
  lg: "text-sm px-7 py-4",
};

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-ink border-accent hover:bg-bg hover:text-accent",
  secondary:
    "bg-transparent text-fg border-line-strong hover:border-accent hover:text-accent",
  danger:
    "bg-transparent text-danger border-danger/60 hover:bg-danger hover:text-bg hover:border-danger",
  ghost:
    "bg-transparent text-dim border-transparent hover:text-fg hover:border-line",
};

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  href?: string;
  external?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", href, external, className = "", children, ...rest },
  ref,
) {
  const cls = `${base} ${sizes[size]} ${variants[variant]} ${className}`;
  if (href) {
    if (external) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
          {children}
        </a>
      );
    }
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button ref={ref} className={cls} {...rest}>
      {children}
    </button>
  );
});
