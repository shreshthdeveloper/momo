/**
 * The Central Bank's topics — the organization console's topic list, mounted
 * inside the platform console.
 *
 * One screen, two doors. The alternative was a second topic list that drifted
 * from the first the week after it was written; `useConsoleSpace` reads the
 * route it is mounted under and scopes every request to the Public Arena, so
 * there is nothing here to keep in step.
 */
export { default } from '../admin/topics.jsx';
