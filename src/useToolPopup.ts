import {
  autoUpdate,
  flip,
  offset,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";

export default function useToolPopup(open: boolean, setOpen: (open: boolean) => void) {
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (open, event, reason) => {
      // A dropdown inside the popup already handled this Escape by closing
      // itself, so the popup stays open.
      if (reason === "escape-key" && event?.defaultPrevented) return;
      setOpen(open);
    },
    placement: "bottom-end",
    middleware: [flip(), offset(10)],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context);

  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    role,
  ]);

  return { refs, floatingStyles, context, getReferenceProps, getFloatingProps };
}
