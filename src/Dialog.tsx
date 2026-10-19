"use client";
import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FaTimes } from "react-icons/fa";
import styles from "./Dialog.module.css";

export default function Dialog({ title, icon, children, onClose }: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [returnFocus] = useState(() => typeof document === "undefined" ? null : document.activeElement as HTMLElement | null);

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
      ref={ref}
      className={styles.Dialog}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => event.stopPropagation()}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      }}
    >
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
    </dialog>,
    document.body,
  );
}
