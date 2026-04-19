/**
 * CSS Property Observation Engine
 *
 * Generic engine that bridges CSS Custom Properties with JavaScript callbacks.
 * Watches for property changes on elements and invokes registered callbacks.
 */

export {
  defineProperties,
  createEngine,
  getEngine,
  destroyEngine,
  CSSPropertyEngine,
} from './engine';

export type {
  PropertyCallback,
  PropertyDefinition,
  PropertyDefinitions,
  PropertySyntax,
  EngineOptions,
} from './engine';
