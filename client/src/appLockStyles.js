/** Shared look of the app-lock screens - the dark theme the other pages use. US-05 (#17). */

export const colors = {
  page: '#0b1120',
  card: '#172033',
  cardBorder: '#283449',
  input: '#101827',
  inputBorder: '#344054',
  text: '#f8fafc',
  muted: '#94a3b8',
  green: '#16a34a',
  greenSoft: '#86efac',
  red: '#f87171',
};

export const pageStyle = {
  minHeight: '100vh',
  boxSizing: 'border-box',
  padding: '32px 18px',
  background: colors.page,
  color: colors.text,
  fontFamily: 'Inter, Segoe UI, sans-serif',
};

export const cardStyle = {
  padding: 22,
  marginBottom: 18,
  background: colors.card,
  border: `1px solid ${colors.cardBorder}`,
  borderRadius: 16,
};

export const labelStyle = {
  display: 'block',
  marginBottom: 14,
  fontSize: 14,
  fontWeight: 600,
  color: '#e2e8f0',
};

export const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 6,
  padding: '10px 12px',
  border: `1px solid ${colors.inputBorder}`,
  borderRadius: 9,
  background: colors.input,
  color: colors.text,
  fontSize: 15,
};

export const pinInputStyle = {
  ...inputStyle,
  textAlign: 'center',
  fontSize: 28,
  letterSpacing: 14,
  paddingLeft: 26,
};

export function buttonStyle(busy, variant = 'primary') {
  const base = {
    width: '100%',
    padding: 12,
    border: 0,
    borderRadius: 9,
    color: '#fff',
    fontSize: 15,
    fontWeight: 700,
    cursor: busy ? 'wait' : 'pointer',
    marginTop: 8,
  };

  if (variant === 'secondary') return { ...base, background: '#334155' };
  if (variant === 'ghost') return { ...base, background: 'transparent', border: '1px solid #475569' };
  if (variant === 'danger') return { ...base, background: busy ? '#64748b' : '#b3261e' };

  return { ...base, background: busy ? '#64748b' : colors.green };
}

export const errorStyle = {
  marginTop: 14,
  padding: 12,
  background: '#451a1a',
  color: '#fecaca',
  borderRadius: 8,
  fontSize: 14,
  lineHeight: 1.5,
};

export const noticeStyle = {
  marginTop: 14,
  padding: 12,
  background: '#123524',
  color: '#bbf7d0',
  borderRadius: 8,
  fontSize: 14,
  lineHeight: 1.5,
};
