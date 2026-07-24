// ponytail: shadcn/ui CLI v3 reads this file to discover Tailwind
// setup. We actually use Tailwind v4 (CSS-first, no JS config), so
// the only thing shadcn needs from us is the content glob. The
// real theme lives in src/styles.css under @theme.
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
};
