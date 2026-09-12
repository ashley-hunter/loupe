/** Vite emits an asset URL for image imports. */
declare module '*.png' {
  const url: string;
  export default url;
}
