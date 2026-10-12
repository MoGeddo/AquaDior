import type { ReactNode } from "react";

export function Modal({
  title,
  children,
  onClose,
  centered = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  centered?: boolean;
}) {
  return (
    <div
      role="presentation"
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
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
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
