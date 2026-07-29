import { createContext, useContext } from 'react';

/**
 * The console sidebar's handle, in a module of its own.
 *
 * `ConsoleShell` renders the sidebar and `ui.jsx`'s `Header` raises it, and
 * `ConsoleShell` draws its own rows with `Text` from `ui.jsx` — so putting the
 * context in either one makes the two import each other. A cycle that happens
 * to work today is a cycle that breaks the day Metro reorders the graph.
 *
 * `null` outside a console, which is exactly how `Header` decides whether the
 * slot where a back arrow would go should carry a menu button instead.
 */
export const ConsoleNav = createContext(null);

export function useConsoleNav() {
  return useContext(ConsoleNav);
}
