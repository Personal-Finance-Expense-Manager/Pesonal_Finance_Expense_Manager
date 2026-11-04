import { colors } from './pageKit.js';

/** Small shared components for the US-16 / US-17 pages. */

export function FieldError({ text }) {
  if (!text) return null;
  return (
    <span role="alert" style={{ display: 'block', marginTop: 5, color: colors.redText, fontWeight: 400, fontSize: 13 }}>
      {text}
    </span>
  );
}

export function Badge({ look }) {
  return (
    <span style={{
      padding: '3px 9px', borderRadius: 999, fontSize: 12, fontWeight: 600,
      background: look.bg, color: look.text, whiteSpace: 'nowrap',
    }}>
      {look.label}
    </span>
  );
}
