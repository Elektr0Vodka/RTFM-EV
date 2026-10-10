// Stylesheets imported for their side effect (`import './index.css'`). TypeScript 6
// checks that such imports resolve (noUncheckedSideEffectImports is on by default);
// Vite handles the file, so it only needs to be declared.
declare module '*.css';
