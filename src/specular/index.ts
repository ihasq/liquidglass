/**
 * Specular Highlight Generation Engine
 *
 * Renders Phong specular highlights using Canvas2D primitives.
 * Primary rendering via CSS Paint Worklet (specular-worklet.js).
 */

export {
  drawSpecular,
  generateSpecularMap,
} from './highlight';

export type {
  SpecularParams,
  SpecularMapOptions,
  SpecularMapResult,
} from './highlight';

// Note: specular-worklet.js is imported as ?raw in core/driver.ts
// and registered as a CSS Paint Worklet. It cannot be exported as a module.
