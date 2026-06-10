import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="bottom-right"
      closeButton
      visibleToasts={3}
      duration={2600}
      offset={{ bottom: 120, right: 16 }}
      mobileOffset={{ bottom: 108, left: 12, right: 12 }}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:!rounded-xl group-[.toaster]:!border-border group-[.toaster]:!bg-card group-[.toaster]:!text-card-foreground group-[.toaster]:shadow-2xl group-[.toaster]:!opacity-100",
          title: "group-[.toast]:!text-inherit",
          description: "group-[.toast]:!text-inherit group-[.toast]:opacity-90",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success:
            "group-[.toaster]:!bg-[hsl(var(--ef-green))] group-[.toaster]:!text-[hsl(var(--primary-foreground))] group-[.toaster]:!border-[hsl(var(--ef-green))]",
          error:
            "group-[.toaster]:!bg-destructive group-[.toaster]:!text-destructive-foreground group-[.toaster]:!border-destructive",
          loading:
            "group-[.toaster]:!bg-primary group-[.toaster]:!text-primary-foreground group-[.toaster]:!border-primary group-[.toaster]:!opacity-100",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
