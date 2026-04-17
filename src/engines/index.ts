/**
 * CSS Property Engine - Bridges CSS Custom Properties with JavaScript
 */

export {
  defineProperties,
  createEngine,
  getEngine,
  destroyEngine,
  CSSPropertyEngine,
} from './css-property-engine';

export type {
  PropertyCallback,
  PropertyDefinition,
  PropertyDefinitions,
  PropertySyntax,
  EngineOptions,
} from './css-property-engine';
