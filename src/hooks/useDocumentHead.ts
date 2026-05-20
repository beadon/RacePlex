import { useEffect } from "react";

interface DocumentHeadOptions {
  title: string;
  description?: string;
  canonical?: string;
}

/**
 * Lightweight per-route head manager. Sets <title>, meta description,
 * and canonical link, then restores them on unmount so other routes
 * fall back to the static defaults in index.html.
 */
export function useDocumentHead({ title, description, canonical }: DocumentHeadOptions): void {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;

    const setMeta = (selector: string, create: () => HTMLElement, value: string) => {
      let el = document.head.querySelector<HTMLElement>(selector);
      const created = !el;
      if (!el) {
        el = create();
        document.head.appendChild(el);
      }
      const prev = el.getAttribute(el.tagName === "META" ? "content" : "href");
      el.setAttribute(el.tagName === "META" ? "content" : "href", value);
      return () => {
        if (created) el?.remove();
        else if (prev !== null) el?.setAttribute(el.tagName === "META" ? "content" : "href", prev);
      };
    };

    const restorers: Array<() => void> = [];
    if (description) {
      restorers.push(
        setMeta(
          'meta[name="description"]',
          () => {
            const m = document.createElement("meta");
            m.setAttribute("name", "description");
            return m;
          },
          description,
        ),
      );
    }
    if (canonical) {
      restorers.push(
        setMeta(
          'link[rel="canonical"]',
          () => {
            const l = document.createElement("link");
            l.setAttribute("rel", "canonical");
            return l;
          },
          canonical,
        ),
      );
    }

    return () => {
      document.title = prevTitle;
      restorers.forEach((r) => r());
    };
  }, [title, description, canonical]);
}
