import { colors } from './pageKit.js';

/**
 * Shown by a feature page when nobody is signed in (US-28, SEC-4).
 *
 * Every page identifies the caller with the session token only. There is no
 * pasted user id any more; a signed-out visitor is sent to the sign-in screen
 * at "#/" (App.jsx), and the server would refuse the request anyway.
 */
export default function SignInRequired({ what = 'this page' }) {
  return (
    <section
      role="status"
      style={{
        padding: 22, marginBottom: 18, background: colors.card,
        border: `1px solid ${colors.cardBorder}`, borderRadius: 16,
      }}
    >
      <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Sign in to continue</h2>
      <p style={{ margin: '0 0 14px', color: colors.muted }}>
        You need to be signed in to use {what}.
      </p>
      <a
        href="#/"
        style={{
          display: 'inline-block', padding: '10px 16px', borderRadius: 9,
          background: colors.green, color: '#fff', fontSize: 14, fontWeight: 600, textDecoration: 'none',
        }}
      >
        Go to sign in
      </a>
    </section>
  );
}

/** The same notice as a whole page, for screens that have nothing to show without a session. */
export function SignedOutPage({ title, what }) {
  return (
    <main
      style={{
        minHeight: '100vh', background: colors.page, color: colors.text,
        padding: 24, fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <a href="#/" style={{ color: colors.muted, textDecoration: 'none' }}>← Back</a>
        <h1>{title}</h1>
        <SignInRequired what={what} />
      </div>
    </main>
  );
}
