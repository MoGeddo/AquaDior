import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Modal } from "./Modal";

export type DialogTone = "primary" | "danger";
export type MessageTone = "info" | "success" | "error";

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: DialogTone;
}

export interface AlertDialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  tone?: MessageTone;
}

export interface PromptDialogOptions {
  title: string;
  message: string;
  inputLabel?: string;
  placeholder?: string;
  initialValue?: string;
  confirmText?: string;
  cancelText?: string;
  maxLength?: number;
  minLength?: number;
  required?: boolean;
  tone?: DialogTone;
}

type DialogRequest =
  | {
      id: number;
      kind: "alert";
      options: AlertDialogOptions;
      resolve: () => void;
    }
  | {
      id: number;
      kind: "confirm";
      options: ConfirmDialogOptions;
      resolve: (value: boolean) => void;
    }
  | {
      id: number;
      kind: "prompt";
      options: PromptDialogOptions;
      resolve: (value: string | null) => void;
    };

interface DialogContextValue {
  alert: (options: AlertDialogOptions) => Promise<void>;
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  prompt: (options: PromptDialogOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const [promptValue, setPromptValue] = useState("");
  const [promptError, setPromptError] = useState("");
  const nextId = useRef(1);
  const active = queue[0] ?? null;

  const alert = useCallback((options: AlertDialogOptions) => {
    return new Promise<void>((resolve) => {
      const request: DialogRequest = {
        id: nextId.current++,
        kind: "alert",
        options,
        resolve,
      };
      setQueue((current) => [...current, request]);
    });
  }, []);

  const confirm = useCallback((options: ConfirmDialogOptions) => {
    return new Promise<boolean>((resolve) => {
      const request: DialogRequest = {
        id: nextId.current++,
        kind: "confirm",
        options,
        resolve,
      };
      setQueue((current) => [...current, request]);
    });
  }, []);

  const prompt = useCallback((options: PromptDialogOptions) => {
    return new Promise<string | null>((resolve) => {
      const request: DialogRequest = {
        id: nextId.current++,
        kind: "prompt",
        options,
        resolve,
      };
      setQueue((current) => [...current, request]);
    });
  }, []);

  const complete = useCallback((result?: boolean | string | null) => {
    const request = queue[0];
    if (!request) return;

    if (request.kind === "alert") request.resolve();
    else if (request.kind === "confirm") request.resolve(result === true);
    else request.resolve(typeof result === "string" ? result : null);

    setQueue((current) =>
      current[0]?.id === request.id
        ? current.slice(1)
        : current.filter((item) => item.id !== request.id)
    );
  }, [queue]);

  const cancel = useCallback(() => {
    if (active?.kind === "confirm") complete(false);
    else if (active?.kind === "prompt") complete(null);
    else if (active?.kind === "alert") complete();
  }, [active, complete]);

  useEffect(() => {
    if (!active) {
      setPromptValue("");
      setPromptError("");
      return;
    }
    if (active.kind === "prompt") {
      setPromptValue(active.options.initialValue ?? "");
      setPromptError("");
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, cancel]);

  const handlePromptSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (active?.kind !== "prompt") return;
    const value = promptValue;
    const trimmed = value.trim();
    if (active.options.required && !trimmed) {
      setPromptError("اكتب قيمة قبل المتابعة.");
      return;
    }
    if (active.options.minLength && trimmed.length < active.options.minLength) {
      setPromptError(`اكتب ${active.options.minLength} أحرف على الأقل.`);
      return;
    }
    complete(value);
  };

  const contextValue = useMemo(() => ({ alert, confirm, prompt }), [alert, confirm, prompt]);
  const descriptionId = active ? `app-dialog-message-${active.id}` : undefined;

  return (
    <DialogContext.Provider value={contextValue}>
      {children}
      {active && (
        <Modal
          centered
          title={active.options.title}
          onClose={cancel}
          dialogRole={active.kind === "confirm" ? "alertdialog" : "dialog"}
          describedBy={descriptionId}
        >
          <form className="app-dialog-form" onSubmit={handlePromptSubmit}>
            <div
              id={descriptionId}
              className={`app-dialog-message${active.kind === "alert" && active.options.tone ? ` is-${active.options.tone}` : ""}`}
              dir="auto"
              role={active.kind === "alert" && active.options.tone === "error" ? "alert" : undefined}
            >
              {active.options.message}
            </div>

            {active.kind === "prompt" && (
              <label className="field app-dialog-field">
                <span>{active.options.inputLabel ?? "التفاصيل"}</span>
                <textarea
                  className="input"
                  rows={4}
                  value={promptValue}
                  onChange={(event) => {
                    setPromptValue(event.target.value);
                    if (promptError) setPromptError("");
                  }}
                  placeholder={active.options.placeholder}
                  maxLength={active.options.maxLength ?? 500}
                  aria-invalid={Boolean(promptError)}
                  autoFocus
                />
                {active.options.maxLength && (
                  <small className="app-dialog-counter">
                    {promptValue.length} / {active.options.maxLength}
                  </small>
                )}
              </label>
            )}

            {promptError && <div className="alert error app-dialog-error" role="alert">{promptError}</div>}

            <div className="app-dialog-actions">
              {active.kind !== "alert" && (
                <button className="btn" type="button" onClick={cancel} autoFocus={active.kind === "confirm"}>
                  {active.options.cancelText ?? "إلغاء"}
                </button>
              )}
              <button
                className={`btn ${active.kind === "alert" || active.options.tone !== "danger" ? "btn-primary" : "btn-danger"}`}
                type={active.kind === "prompt" ? "submit" : "button"}
                onClick={active.kind === "confirm" ? () => complete(true) : active.kind === "alert" ? () => complete() : undefined}
                autoFocus={active.kind === "alert"}
              >
                {active.kind === "alert"
                  ? active.options.confirmText ?? "حسنًا"
                  : active.options.confirmText ?? (active.kind === "prompt" ? "متابعة" : "تأكيد")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </DialogContext.Provider>
  );
}

// oxlint-disable-next-line react/only-export-components
export function useDialog(): DialogContextValue {
  const context = useContext(DialogContext);
  if (!context) throw new Error("useDialog must be used inside DialogProvider");
  return context;
}
