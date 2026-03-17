const map: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
};

export function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => map[c]);
}
