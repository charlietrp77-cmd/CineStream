import { useEffect, useRef } from 'react';

/**
 * Universal TV & D-Pad Remote Navigation System
 *
 * Implements smooth 2D geometric directional navigation using ArrowUp/Down/Left/Right,
 * Enter activation, and unified Back/Backspace/Escape handling for Android TV, Smart TV
 * remotes (Samsung Tizen, LG webOS), and laptop keyboards.
 */

export interface BackHandler {
  priority: number; // Higher number executed first
  handleBack: () => boolean; // Return true if handled, false to pass to next handler
}

const backHandlers: BackHandler[] = [];

export function registerBackHandler(handler: BackHandler) {
  backHandlers.push(handler);
  backHandlers.sort((a, b) => b.priority - a.priority);
  return () => {
    const idx = backHandlers.indexOf(handler);
    if (idx !== -1) backHandlers.splice(idx, 1);
  };
}

export function triggerGlobalBack(): boolean {
  for (const h of backHandlers) {
    if (h.handleBack()) {
      return true;
    }
  }
  return false;
}

/**
 * Determines whether a key event represents a Back / Return command across devices
 */
export function isBackKeyEvent(e: KeyboardEvent): boolean {
  if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.key === 'BrowserBack') {
    return true;
  }
  // Android Back (4), Backspace (8), Escape (27), webOS Return (461), Tizen Return (10009)
  if (e.keyCode === 4 || e.keyCode === 8 || e.keyCode === 27 || e.keyCode === 461 || e.keyCode === 10009) {
    return true;
  }
  return false;
}

/**
 * Finds all visible, focusable interactive elements within a given container
 */
function getFocusableElements(container: HTMLElement | Document = document): HTMLElement[] {
  const selector =
    'button:not([disabled]), a[href]:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="button"]:not([aria-disabled="true"]), [tabindex="0"], [data-focusable="true"]';
  const elements = Array.from(container.querySelectorAll<HTMLElement>(selector));

  return elements.filter((el) => {
    if (el.getAttribute('aria-hidden') === 'true' || el.style.display === 'none' || el.style.visibility === 'hidden') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

/**
 * Gets the current active modal or layer container, ensuring focus stays trapped inside active overlays
 */
function getActiveScopeContainer(): HTMLElement {
  const scopes = Array.from(document.querySelectorAll<HTMLElement>('[data-focus-scope="true"]'));
  for (let i = scopes.length - 1; i >= 0; i--) {
    const s = scopes[i];
    const rect = s.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && window.getComputedStyle(s).display !== 'none') {
      return s;
    }
  }
  return document.body;
}

/**
 * Calculates geometric distance and directional score between current element and candidate
 */
function calculateDirectionScore(
  currentRect: DOMRect,
  candRect: DOMRect,
  direction: 'up' | 'down' | 'left' | 'right'
): number | null {
  const currentCenter = {
    x: currentRect.left + currentRect.width / 2,
    y: currentRect.top + currentRect.height / 2,
  };
  const candCenter = {
    x: candRect.left + candRect.width / 2,
    y: candRect.top + candRect.height / 2,
  };

  const deltaX = candCenter.x - currentCenter.x;
  const deltaY = candCenter.y - currentCenter.y;

  // Strict directional boundary check (must actually be in the requested direction)
  if (direction === 'right') {
    if (candRect.left < currentRect.left + 4 || deltaX <= 0) return null;
    const verticalOverlap = Math.max(
      0,
      Math.min(currentRect.bottom, candRect.bottom) - Math.max(currentRect.top, candRect.top)
    );
    const primaryDist = candRect.left - currentRect.right;
    const secondaryDist = Math.abs(deltaY);
    return (verticalOverlap > 0 ? 0 : secondaryDist * 2.8) + (primaryDist > 0 ? primaryDist : 0) + Math.abs(deltaY);
  }

  if (direction === 'left') {
    if (candRect.right > currentRect.right - 4 || deltaX >= 0) return null;
    const verticalOverlap = Math.max(
      0,
      Math.min(currentRect.bottom, candRect.bottom) - Math.max(currentRect.top, candRect.top)
    );
    const primaryDist = currentRect.left - candRect.right;
    const secondaryDist = Math.abs(deltaY);
    return (verticalOverlap > 0 ? 0 : secondaryDist * 2.8) + (primaryDist > 0 ? primaryDist : 0) + Math.abs(deltaY);
  }

  if (direction === 'down') {
    if (candRect.top < currentRect.top + 4 || deltaY <= 0) return null;
    const horizontalOverlap = Math.max(
      0,
      Math.min(currentRect.right, candRect.right) - Math.max(currentRect.left, candRect.left)
    );
    const primaryDist = candRect.top - currentRect.bottom;
    const secondaryDist = Math.abs(deltaX);
    return (horizontalOverlap > 0 ? 0 : secondaryDist * 2.2) + (primaryDist > 0 ? primaryDist : 0) + Math.abs(deltaX) * 0.8;
  }

  if (direction === 'up') {
    if (candRect.bottom > currentRect.bottom - 4 || deltaY >= 0) return null;
    const horizontalOverlap = Math.max(
      0,
      Math.min(currentRect.right, candRect.right) - Math.max(currentRect.left, candRect.left)
    );
    const primaryDist = currentRect.top - candRect.bottom;
    const secondaryDist = Math.abs(deltaX);
    return (horizontalOverlap > 0 ? 0 : secondaryDist * 2.2) + (primaryDist > 0 ? primaryDist : 0) + Math.abs(deltaX) * 0.8;
  }

  return null;
}

/**
 * Navigates spatially in the given direction from current focused element
 */
export function navigateSpatial(direction: 'up' | 'down' | 'left' | 'right'): boolean {
  const container = getActiveScopeContainer();
  const focusables = getFocusableElements(container);

  if (focusables.length === 0) return false;

  let activeEl = document.activeElement as HTMLElement | null;

  // If no element or body is focused, or focus is outside active scope, focus first candidate or autofocus
  if (!activeEl || activeEl === document.body || !container.contains(activeEl)) {
    const autoFocusEl =
      container.querySelector<HTMLElement>('[data-autofocus="true"]') ||
      focusables.find((f) => f.getAttribute('data-priority') === 'high') ||
      focusables[0];

    if (autoFocusEl) {
      autoFocusEl.focus();
      autoFocusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      return true;
    }
    return false;
  }

  const currentRect = activeEl.getBoundingClientRect();
  let bestCandidate: HTMLElement | null = null;
  let lowestScore = Infinity;

  for (const cand of focusables) {
    if (cand === activeEl) continue;
    const candRect = cand.getBoundingClientRect();
    const score = calculateDirectionScore(currentRect, candRect, direction);

    if (score !== null && score < lowestScore) {
      lowestScore = score;
      bestCandidate = cand;
    }
  }

  if (bestCandidate) {
    bestCandidate.focus();
    bestCandidate.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    return true;
  }

  return false;
}

/**
 * Initializes global spatial navigation, Enter execution, and Backspace/Escape handling
 */
let isNavInitialized = false;

export function useSpatialNavInit() {
  const lastKeyTimeRef = useRef(0);

  useEffect(() => {
    if (isNavInitialized) return;
    isNavInitialized = true;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput = activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement;

      // 1. Back / Escape / TV Remote Back
      if (isBackKeyEvent(e)) {
        // If user is editing text in an input and presses Backspace, let native input backspace occur
        if (isInput && (e.key === 'Backspace' || e.keyCode === 8)) {
          // If input is empty, back can exit the search or form
          const inputVal = (activeEl as HTMLInputElement).value;
          if (inputVal === '') {
            e.preventDefault();
            (activeEl as HTMLElement).blur();
            triggerGlobalBack();
          }
          return;
        }

        // For Escape or TV Remote Back (even if in input), blur and trigger app Back
        e.preventDefault();
        if (isInput) (activeEl as HTMLElement).blur();
        triggerGlobalBack();
        return;
      }

      // 2. Arrow D-Pad Navigation
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // If typing inside an input and pressing Left/Right, allow native cursor movement within text
        if (isInput && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          return;
        }

        // Throttle key repeats to avoid runaway scrolling on hold
        const now = Date.now();
        if (now - lastKeyTimeRef.current < 45) {
          e.preventDefault();
          return;
        }
        lastKeyTimeRef.current = now;

        const dirMap: Record<string, 'up' | 'down' | 'left' | 'right'> = {
          ArrowUp: 'up',
          ArrowDown: 'down',
          ArrowLeft: 'left',
          ArrowRight: 'right',
        };

        const dir = dirMap[e.key];
        if (dir) {
          const moved = navigateSpatial(dir);
          if (moved) {
            e.preventDefault();
          }
        }
        return;
      }

      // 3. Enter Key Activation
      if (e.key === 'Enter') {
        if (activeEl instanceof HTMLElement && activeEl !== document.body && !isInput) {
          e.preventDefault();
          activeEl.click();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      isNavInitialized = false;
    };
  }, []);
}
