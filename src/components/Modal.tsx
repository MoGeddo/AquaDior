import type { ReactNode } from "react";

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 50,
        paddingTop: "env(safe-area-inset-top)",
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card)",
          borderRadius: "22px 22px 0 0",
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
          <b style={{ fontSize: 17 }}>{title}</b>
          <button className="btn modal-close btn-ghost" onClick={onClose} aria-label="إغلاق النافذة">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
