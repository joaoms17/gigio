/**
 * Cores de projeto na v2. Os projetos criados na v1 guardaram cores da
 * paleta antiga (roxo/rosa por defeito) — são remapeadas só na apresentação,
 * sem tocar nos dados, para os LEDs de banda não "cheirarem" à v1.
 */
const LEGACY_TO_V2: Record<string, string> = {
  '7C3AED': '#4CC9F0',
  'FF4D6D': '#FFC24B',
  '2563EB': '#2F6FEB',
  '059669': '#0E9F6E',
  'D97706': '#B45309',
  'DB2777': '#A8A29E',
  '0891B2': '#0891B2',
  '9333EA': '#64748B',
  'DC2626': '#DC2626',
  '16A34A': '#3DDC97',
}

/** Paleta oferecida ao criar/editar projetos. */
export const PROJECT_COLORS_V2 = Array.from(new Set(Object.values(LEGACY_TO_V2)))

export function mapLegacyProjectColor(raw: string): string {
  return LEGACY_TO_V2[raw.trim().replace(/^#/, '').toUpperCase()] ?? raw
}
