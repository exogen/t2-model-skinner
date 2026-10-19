"use client";
import { useCallback, useState } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import Dialog from "./Dialog";
import styles from "./Dialog.module.css";

export default function useMessageDialog() {
  const [message, setMessage] = useState<{ title: string; text: string } | null>(null);
  const showMessage = useCallback((text: string, title: string) => setMessage({ title, text }), []);
  const close = () => setMessage(null);
  return {
    showMessage,
    messageDialog: message ? (
      <Dialog title={message.title} icon={<FaExclamationTriangle aria-hidden="true" />} onClose={close}>
        <div className={styles.Body}><p className={styles.Message} role="alert">{message.text}</p></div>
        <footer className={styles.Footer}>
          <button type="button" className={`${styles.Button} ${styles.Primary}`} onClick={close}>OK</button>
        </footer>
      </Dialog>
    ) : null,
  };
}
