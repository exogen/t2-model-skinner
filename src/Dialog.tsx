"use client";
import { ReactNode, useCallback, useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { PortalContext } from "@ariakit/react";
import { FaTimes } from "react-icons/fa";
import styles from "./Dialog.module.css";

/** Whether the pointer is on a modal dialog's backdrop, which belongs to the
 * dialog element but lies outside its box. */
function onBackdrop(event: MouseEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) return false;
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right ||
    event.clientY < rect.top || event.clientY > rect.bottom;
}

export default function Dialog({ title, icon, children, onClose, className = "" }: {
  title: string;
  className?: string;
  icon?: ReactNode;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  // Popovers inside, like a Select's, portal into the dialog: anything outside
  // a modal dialog is drawn under it and can't be clicked.
  const [portalRoot, setPortalRoot] = useState<HTMLDialogElement | null>(null);
  const attach = useCallback((element: HTMLDialogElement | null) => {
    ref.current = element;
    setPortalRoot(element);
  }, []);
  // Whether the pointer went down on the backdrop. A drag from inside that ends
  // there, like selecting text in a search box, also clicks the dialog, but
  // doesn't close it.
  const pressedBackdrop = useRef(false);
  const titleId = useId();
  const [returnFocus] = useState(() => typeof document === "undefined" ? null : document.activeElement as HTMLElement | null);

  // Opens with the first commit, before content effects that move focus.
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      window.requestAnimationFrame(() => {
        if (returnFocus?.isConnected) returnFocus.focus();
      });
    };
  }, [returnFocus]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={attach}
      className={`${styles.Dialog} ${className}`}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => event.stopPropagation()}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onPointerDownCapture={(event) => {
        // With a dropdown open, like a Select's, a click outside it only
        // closes the dropdown. That's an open Ariakit popover, not an
        // expanded combobox: a list that's always shown, like the photo
        // strip's maps, keeps its combobox expanded.
        pressedBackdrop.current = onBackdrop(event) &&
          !event.currentTarget.querySelector("[data-dialog][data-open]");
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && onBackdrop(event)) onClose();
      }}
    >
      <PortalContext.Provider value={portalRoot}>
        <header className={styles.Header}>
          {icon ? <span className={styles.Icon}>{icon}</span> : null}
          <div className={styles.Heading}>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className={styles.Close} aria-label="Close dialog" onClick={onClose}>
            <FaTimes />
          </button>
        </header>
        {children}
      </PortalContext.Provider>
    </dialog>,
    document.body,
  );
}
