import { phDigits, phLocal, phStored } from '../services/phone';

/**
 * Philippine mobile number: a fixed "+63", then up to 10 digits starting with 9, spaced as typed
 * (917 123 4567). `value` / `onChange` use the saved form "+63 917 123 4567".
 */
export function PhoneInput({ value, onChange, id }: { value: string; onChange: (stored: string) => void; id?: string }) {
  const digits = phDigits(value);
  return (
    <div className="phone-input">
      <span className="phone-prefix" aria-hidden="true">
        🇵🇭 +63
      </span>
      <input
        id={id}
        className="input"
        inputMode="numeric"
        autoComplete="tel-national"
        value={phLocal(digits)}
        onChange={(e) => onChange(phStored(e.target.value))}
        placeholder="917 123 4567"
        maxLength={12}
        aria-label="Mobile number after +63"
      />
    </div>
  );
}
