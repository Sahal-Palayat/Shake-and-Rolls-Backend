/** Indian mobile: 10 digits starting 6-9, optional +91 prefix. */
export const IN_MOBILE_REGEX = /^(\+91)?[6-9]\d{9}$/;

/** Normalise to E.164 (+91XXXXXXXXXX). Caller must have validated against IN_MOBILE_REGEX. */
export function normalizePhone(input: string): string {
  return input.startsWith('+91') ? input : `+91${input}`;
}
