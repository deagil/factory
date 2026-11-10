import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "cn";

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-2xl border-2 shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)] transition-all outline-none group-has-[:focus-visible]/field-label:ring-0 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-7 data-[size=default]:w-12 data-[size=sm]:h-4 data-[size=sm]:w-6 dark:shadow-[inset_0_1px_2px_rgb(0_0_0/0.35)] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-emerald-600 data-checked:bg-emerald-600 group-has-[:focus-visible]/field-label:data-checked:border-emerald-600 dark:data-checked:border-emerald-500 dark:data-checked:bg-emerald-500 dark:group-has-[:focus-visible]/field-label:data-checked:border-emerald-500 data-unchecked:border-input data-unchecked:bg-muted group-has-[:focus-visible]/field-label:data-unchecked:border-input data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-2xl bg-background shadow-sm ring-0 transition-transform not-dark:bg-clip-padding group-data-[size=default]/switch:size-6 group-data-[size=sm]/switch:size-3 data-checked:translate-x-[calc(100%-4px)] dark:data-checked:bg-primary-foreground data-unchecked:translate-x-0 dark:data-unchecked:bg-foreground"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
