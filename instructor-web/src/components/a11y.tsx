import { useEffect, useRef, useState } from 'react';

import { Icon, type IconName } from './icons';
import { SCALES, resetPrefs, setPrefs, usePrefs, type Contrast, type Theme } from '../services/prefs';

const THEMES: [Theme, string, IconName][] = [
  ['light', 'Light', 'sun'],
  ['dark', 'Dark', 'moon'],
  ['system', 'Device', 'monitor'],
];
const CONTRASTS: [Contrast, string][] = [
  ['normal', 'Standard'],
  ['high', 'High'],
];

/** Text size, theme (light / dark / device) and contrast controls. */
export function A11yControls() {
  const p = usePrefs();
  const i = SCALES.indexOf(p.scale);
  return (
    <div className="a11y-controls">
      <div className="a11y-group">
        <span id="a11y-size">Text size</span>
        <div className="a11y-size" role="group" aria-labelledby="a11y-size">
          <button type="button" onClick={() => setPrefs({ scale: SCALES[i - 1] })} disabled={i <= 0} aria-label="Smaller text">
            A−
          </button>
          <output aria-live="polite">{Math.round(p.scale * 100)}%</output>
          <button type="button" onClick={() => setPrefs({ scale: SCALES[i + 1] })} disabled={i >= SCALES.length - 1} aria-label="Larger text">
            A+
          </button>
        </div>
      </div>

      <div className="a11y-group">
        <span id="a11y-theme">Theme</span>
        <div className="seg" role="radiogroup" aria-labelledby="a11y-theme">
          {THEMES.map(([v, label, icon]) => (
            <button type="button" key={v} role="radio" aria-checked={p.theme === v} className={p.theme === v ? 'on' : ''} onClick={() => setPrefs({ theme: v })}>
              <Icon name={icon} size={15} /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="a11y-group">
        <span id="a11y-contrast">Color contrast</span>
        <div className="seg" role="radiogroup" aria-labelledby="a11y-contrast">
          {CONTRASTS.map(([v, label]) => (
            <button type="button" key={v} role="radio" aria-checked={p.contrast === v} className={p.contrast === v ? 'on' : ''} onClick={() => setPrefs({ contrast: v })}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="a11y-reset" onClick={resetPrefs}>
        Reset to default
      </button>
    </div>
  );
}

/** "Accessibility" row inside the profile menu; opens the controls right below it. */
export function A11yMenuItem() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" role="menuitem" className={`a11y-item${open ? ' on' : ''}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="accessibility" size={16} /> Accessibility
        <span className="a11y-chev">
          <Icon name="chevronDown" size={14} />
        </span>
      </button>
      {open ? (
        <div className="a11y-inline">
          <A11yControls />
        </div>
      ) : null}
    </>
  );
}

/** Stand-alone accessibility button + panel (sign-in pages, where there is no profile menu). */
export function A11yMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="a11y" ref={ref}>
      <button
        type="button"
        className={`a11y-btn${open ? ' on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Accessibility settings"
        title="Accessibility: text size, theme, contrast">
        <Icon name="accessibility" size={20} />
      </button>
      {open ? (
        <div className="dropdown a11y-panel" role="dialog" aria-label="Accessibility settings">
          <div>
            <h3>Accessibility</h3>
            <p>Saved on this device and browser.</p>
          </div>
          <A11yControls />
        </div>
      ) : null}
    </div>
  );
}
