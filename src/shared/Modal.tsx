import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  title: string;
  children: ReactNode;
  /** Без onClose окно нельзя закрыть: ни крестиком, ни клавишей Esc, ни кликом мимо. */
  onClose?: () => void;
  wide?: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea';

/** Открытые окна, верхнее последним: клавиши обрабатывает только оно. */
const openModals: string[] = [];

// Обычный div вместо <dialog>: нативное модальное окно делает остальную страницу
// неактивной и перекрывает окно reCAPTCHA, и вход по телефону перестаёт работать.
export function Modal({ title, children, onClose, wide }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    openModals.push(titleId);

    // Слушаем весь документ, а не окно: кнопка отправки на время запроса отключается,
    // браузер снимает с неё фокус, и нажатия больше не доходили бы до окна.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== titleId) return;
      if (event.key === 'Escape') {
        closeRef.current?.();
        return;
      }
      const panel = panelRef.current;
      if (event.key !== 'Tab' || !panel) return;
      const items = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      openModals.splice(openModals.lastIndexOf(titleId), 1);
      previous?.focus?.();
    };
  }, [titleId]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        className={wide ? 'modal modal-wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          {onClose && (
            <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть">
              <X size={20} aria-hidden />
            </button>
          )}
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
