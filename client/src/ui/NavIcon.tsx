/** Іконки меню — з прототипу (статичні SVG-шляхи). */
import type { Section } from '@vudo/shared';

const PATHS: Record<Section, string> = {
  orders: "<path d=\"M8 6h12M8 12h12M8 18h12\"/><circle cx=\"4\" cy=\"6\" r=\".8\"/><circle cx=\"4\" cy=\"12\" r=\".8\"/><circle cx=\"4\" cy=\"18\" r=\".8\"/>",
  crm: "<rect x=\"3\" y=\"4\" width=\"5\" height=\"16\" rx=\"1.5\"/><rect x=\"10\" y=\"4\" width=\"5\" height=\"10\" rx=\"1.5\"/><rect x=\"17\" y=\"4\" width=\"4\" height=\"13\" rx=\"1.5\"/>",
  plan: "<path d=\"M3 5h18M3 19h18\"/><rect x=\"5\" y=\"8\" width=\"8\" height=\"3\" rx=\"1\"/><rect x=\"10\" y=\"13\" width=\"9\" height=\"3\" rx=\"1\"/>",
  stock: "<path d=\"M3 8l9-5 9 5v13H3z\"/><path d=\"M7 21v-7h10v7M7 17h10\"/>",
  myday: "<path d=\"M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z\"/><circle cx=\"12\" cy=\"9.5\" r=\"2.5\"/>",
  clients: "<circle cx=\"12\" cy=\"8\" r=\"3.5\"/><path d=\"M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5\"/>",
  finance: "<rect x=\"3\" y=\"6\" width=\"18\" height=\"13\" rx=\"2\"/><path d=\"M3 10h18M16 15h2\"/>",
  stats: "<path d=\"M4 20V10M10 20V4M16 20v-7M21 20H3\"/>",
  time: "<circle cx=\"12\" cy=\"13\" r=\"8\"/><path d=\"M12 9v4l3 2M9 2h6\"/>",
  kb: "<path d=\"M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z\"/>",
  notes: "<path d=\"M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z\"/><path d=\"M10 20.5a2 2 0 0 0 4 0\"/>",
  settings: "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M12 2.5v3M12 18.5v3M4.2 6.2l2.1 2.1M17.7 15.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 17.8l2.1-2.1M17.7 8.3l2.1-2.1\"/>",
};

export function NavIcon({ section }: { section: Section }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: PATHS[section] }} />;
}
