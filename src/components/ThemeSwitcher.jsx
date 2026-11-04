import { useEffect, useState } from 'react';
import { THEMES, THEME_ORDER, applyTheme, readStoredTheme, storeTheme } from '../theme/themes.js';

// Three-segment theme switcher for the top bar. The saved choice is applied before first paint by
// index.html's inline script; this control only changes and stores it (localStorage, wrapped in
// try/catch so a blocked store still lets the theme change for the session).
export default function ThemeSwitcher() {
  const [theme, setTheme] = useState(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function choose(name) {
    setTheme(name);
    storeTheme(name);
  }

  return (
    <div className="theme-switcher" role="radiogroup" aria-label="Theme">
      {THEME_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={theme === name}
          className={theme === name ? 'active' : ''}
          title={THEMES[name].label}
          onClick={() => choose(name)}
        >
          {THEMES[name].short}
        </button>
      ))}
    </div>
  );
}
