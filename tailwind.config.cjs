/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './App.tsx',
    './index.tsx',
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './**/*.{ts,tsx}', // на всякий — если у тебя ещё файлы в корне
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
