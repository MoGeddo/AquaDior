import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import AppIcon from "./AppIcon";

export function Modal({
  title,
  children,
  onClose,
  centered = false,
  dialogRole = "dialog",
  describedBy,
}: {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  centered?: boolean;
  dialogRole?: "dialog" | "alertdialog";
  describedBy?: string;
}) {
  const titleId = `modal-title-${useId().replaceAll(":", "")}`;
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialog = dialogRef.current;
    const preferred = dialog?.querySelector<HTMLElement>("[autofocus]");
    const firstFocusable = dialog?.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    );
    (preferred ?? firstFocusable ?? dialog)?.focus();

    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  function keepFocusInside(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )].filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");

    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      role="presentation"
      className={`modal-backdrop${centered ? " is-centered" : ""}`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: centered ? "center" : "flex-end",
        justifyContent: "center",
        zIndex: 50,
        paddingTop: centered ? "max(16px, env(safe-area-inset-top))" : "env(safe-area-inset-top)",
        paddingRight: centered ? 16 : 0,
        paddingBottom: centered ? "max(16px, env(safe-area-inset-bottom))" : 0,
        paddingLeft: centered ? 16 : 0,
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="modal-panel"
        role={dialogRole}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={keepFocusInside}
        onClick={(event) => event.stopPropagation()}
        style={{
          background: "var(--card)",
          borderRadius: centered ? 22 : "22px 22px 0 0",
          width: "100%",
          maxWidth: 520,
          maxHeight: "min(92dvh, 800px)",
          overflowY: "auto",
          overscrollBehavior: "contain",
          padding: 20,
          paddingBottom: "max(20px, env(safe-area-inset-bottom))",
        }}
      >
        <div className="flex-between mb">
          <h2 id={titleId} style={{ fontSize: 17, lineHeight: 1.45, margin: 0 }}>{title}</h2>
          <button type="button" className="btn modal-close btn-ghost" onClick={onClose} aria-label="إغلاق النافذة">
            <AppIcon name="x" size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
