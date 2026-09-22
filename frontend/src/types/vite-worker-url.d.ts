// Vite `?worker&url` import: bundles the module as a worker and returns its URL.
declare module '*?worker&url' {
  const url: string;
  export default url;
}
