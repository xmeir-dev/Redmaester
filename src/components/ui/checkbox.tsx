"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-[14px] w-[14px] shrink-0 rounded-sm",
      "shadow-[0_0_0_1px_hsl(var(--border))]",
      "focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_hsl(var(--gray-12))]",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-hsl([--accent]) data-[state=checked]:shadow-[0_0_0_1px_hsl(var(--gray-12))]",
      "transition-shadow duration-100",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-white">
      <Check className="h-2.5 w-2.5 stroke-[3]" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
