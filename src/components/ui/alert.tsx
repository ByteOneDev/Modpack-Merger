import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        info: "border-info/30 bg-info/10 text-foreground [&>svg]:text-info",
        warning: "border-warning/40 bg-warning/10 text-foreground [&>svg]:text-warning",
        destructive: "border-destructive/40 bg-destructive/10 text-foreground [&>svg]:text-destructive",
        success: "border-success/40 bg-success/10 text-foreground [&>svg]:text-success",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight", className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        // Bloc plutot que grid : la variante grid de shadcn met chaque enfant
        // sur sa propre ligne, ce qui cassait les phrases contenant du code
        // inline (« un index .mrpack n'accepte que… »).
        "text-muted-foreground col-start-2 text-sm leading-relaxed [&_code]:font-mono [&_code]:text-xs",
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription };
