import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';

interface DialogProps {
  title: string;
  description?: string;
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
  pending?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export function Dialog({
  title,
  description,
  children,
  actions,
  onClose,
  pending = false,
  initialFocusRef,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const panel = panelRef.current;
    const initial =
      initialFocusRef?.current ?? getFocusableElements(panel)[0] ?? panel;
    initial?.focus();
    return () => {
      if (previousFocus?.isConnected === true) previousFocus.focus();
    };
  }, [initialFocusRef]);

  useEffect(() => {
    if (!pending) return;
    const panel = panelRef.current;
    if (panel === null) return;
    const focusable = getFocusableElements(panel);
    if (
      document.activeElement instanceof HTMLElement &&
      focusable.includes(document.activeElement)
    ) {
      return;
    }
    panel.focus();
  }, [pending]);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !pending) {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key !== 'Tab') return;
          const focusable = getFocusableElements(panelRef.current);
          if (focusable.length === 0) {
            event.preventDefault();
            panelRef.current?.focus();
            return;
          }
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (document.activeElement === panelRef.current) {
            event.preventDefault();
            (event.shiftKey ? last : first)?.focus();
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">Application record</span>
            <h2 id={titleId}>{title}</h2>
            {description === undefined ? null : (
              <p id={descriptionId}>{description}</p>
            )}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={`Close ${title}`}
            disabled={pending}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        <footer className="dialog-actions">{actions}</footer>
      </div>
    </div>
  );
}

export function getFocusableElements(
  container: HTMLElement | null,
): HTMLElement[] {
  if (container === null) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]):not(:disabled)',
    ),
  ).filter((element) => element.getAttribute('aria-hidden') !== 'true');
}
