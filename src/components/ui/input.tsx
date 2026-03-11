import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-[var(--radius)] bg-white px-3 py-2 text-sm",
          "shadow-[0_0_0_1px_hsl(var(--border))]",
          "placeholder:text-black/30",
          "focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_rgba(0,0,0,0.25)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "transition-shadow duration-150",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
