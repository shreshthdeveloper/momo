import Ionicons from '@expo/vector-icons/Ionicons';
import { usePalette } from '../theme/palette.jsx';

/**
 * design.md §12 — one icon set, geometric, inheriting the text colour.
 *
 * The set is Ionicons (bundled with Expo — no extra native module), behind the
 * app's own names: call sites say `gear` and `ranks`, never `settings-outline`,
 * so swapping the pack again is one file. The View-drawn originals served
 * until real glyphs were warranted; at this fidelity they were the thing
 * making every header look homemade.
 */
const GLYPHS = {
  // ── Navigation ──────────────────────────────────────────────────────────
  home: 'home',
  grid: 'grid-outline',
  ranks: 'podium',
  friends: 'people',
  user: 'person',
  plus: 'add',
  close: 'close',
  check: 'checkmark',
  search: 'search',
  bell: 'notifications-outline',
  gear: 'settings-sharp',
  share: 'share-social',
  back: 'arrow-back',
  /** The console sidebar's handle. */
  menu: 'menu',
  /** A row's own actions, where naming them all would drown the row. */
  more: 'ellipsis-horizontal',
  /** Delete. Never `close` — an ✕ on a card reads as "dismiss". */
  trash: 'trash-outline',
  /** The console's filter affordance — a search field's companion. */
  filter: 'options-outline',
  chevronLeft: 'chevron-back',
  chevronRight: 'chevron-forward',
  chevronDown: 'chevron-down',
  arrowRight: 'arrow-forward',

  // ── Subjects and states ─────────────────────────────────────────────────
  clock: 'time-outline',
  calendar: 'calendar-outline',
  flag: 'flag',
  book: 'book',
  target: 'locate',
  alert: 'alert-circle',
  sparkle: 'sparkles',
  bolt: 'flash',
  /** The seal on an unopened reward — the takeover's chest. */
  gift: 'gift',
  /** The dock's one action. Filled, because it does something. */
  play: 'game-controller',
  /** Editing your own details — a pencil, not a second gear. */
  edit: 'create-outline',
  lock: 'lock-closed',
  /** Leaving the account, not the screen — the console's one destructive row. */
  logout: 'log-out-outline',

  /**
   * ── Subject glyphs ──────────────────────────────────────────────────────
   * One per category, drawn rather than photographed. Stock cover photos were
   * doing real damage: the Python topic wore a picture of an Arduino board,
   * which is a different subject entirely, and a grid of unrelated photographs
   * has no visual system holding it together. A glyph is always about its
   * subject, always legible at 24px, and costs nothing to download.
   */
  code: 'code-slash',
  calculator: 'calculator',
  flask: 'flask',
  film: 'film',
  trophy: 'trophy',
  medal: 'medal',
  hourglass: 'hourglass',
  globe: 'earth',
  music: 'musical-notes',
  brush: 'color-palette',
  leaf: 'leaf',
  /** The lamp, for mythology — the one subject no object stands in for. */
  flame: 'flame',

  // ── Console sections ────────────────────────────────────────────────────
  /** Moderation and anything that carries authority over an account. */
  shield: 'shield-checkmark',
  /** A broadcast to everybody. */
  megaphone: 'megaphone',
  /** The audit trail: what was done, by whom. */
  history: 'time',
  /** Tenants — an organization as a thing on a shelf. */
  building: 'business',
  /** Machine-drafted questions. */
  robot: 'hardware-chip',
  /** Numbers, as a page rather than a subject. */
  chart: 'bar-chart',
  /** A file leaving the product. */
  download: 'download-outline',
  /** The platform itself. */
  server: 'server',
};

export default function Icon({ name, size = 22, color }) {
  /**
   * The default is resolved from the palette rather than baked in: an icon
   * with no colour of its own is "whatever ink is here", and ink is near-white
   * in the player app and near-black in the consoles.
   */
  const colors = usePalette();
  const glyph = GLYPHS[name] ?? 'help-circle-outline';
  return <Ionicons name={glyph} size={size} color={color ?? colors.ink} />;
}
