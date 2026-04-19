// Type declarations for shader file imports
declare module '*.glsl' {
  const value: string;
  export default value;
}

declare module '*.vert' {
  const value: string;
  export default value;
}

declare module '*.frag' {
  const value: string;
  export default value;
}

declare module '*.wgsl' {
  const value: string;
  export default value;
}

// Vite raw imports — used to pass plain JS source to APIs that reject ES
// modules (e.g. CSS Paint Worklets) via Blob URL wrapping.
declare module '*?raw' {
  const value: string;
  export default value;
}
