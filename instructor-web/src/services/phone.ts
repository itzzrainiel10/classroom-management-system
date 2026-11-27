// Philippine mobile numbers: +63 then 10 digits starting with 9 (e.g. +63 917 123 4567).

/**
 * The local digits ("9171234567") from anything typed, pasted or saved: "917…", "0917…", "+63 917…",
 * "639171234567". Nothing is dropped while typing or deleting; phValid() checks the result.
 */
export function phDigits(raw: string | null | undefined) {
  let s = String(raw ?? '').trim();
  if (s.startsWith('+63')) s = s.slice(3); // the saved form
  let d = s.replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('63')) d = d.slice(2); // pasted 639…
  if (d.startsWith('0')) d = d.slice(1); // 09… → 9…
  return d.slice(0, 10);
}

/** "917 123 4567" (partial input formats as it is typed). */
export function phLocal(digits: string) {
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)].filter(Boolean).join(' ');
}

/** What gets saved: "+63 917 123 4567" ("" when nothing was typed). */
export function phStored(raw: string | null | undefined) {
  const d = phDigits(raw);
  return d ? `+63 ${phLocal(d)}` : '';
}

/** Complete and valid: exactly 10 digits starting with 9. */
export const phValid = (raw: string | null | undefined) => /^9\d{9}$/.test(phDigits(raw));

export const PH_HINT = 'Philippine mobile number: 10 digits after +63, starting with 9 (e.g. 917 123 4567).';
