/**
 * Privacy notice settings - US-28 (#67), SEC-13.
 *
 * PRIVACY_POLICY_VERSION identifies the notice a person consented to. Change it
 * (PRIVACY_POLICY_VERSION in the environment) whenever the notice changes
 * materially, so earlier consents can be told apart from current ones.
 */
export const PRIVACY_POLICY_VERSION = process.env.PRIVACY_POLICY_VERSION || '2026-11';

export const CONSENT_PURPOSES = [
  'account_management',
  'transaction_recording',
  'reporting',
  'security_and_audit',
];
