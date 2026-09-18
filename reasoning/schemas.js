// Shared transport constraints; runtime parsers remain authoritative on every provider.
const text = { type: 'string', minLength: 1 };
const strings = { type: 'array', items: text };
const confidence = { type: 'number', minimum: 0, maximum: 1 };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const proposalSchema = object({ action: text, claims: { type: 'array', minItems: 1, maxItems: 3,
  items: object({ statement: text, evidenceIds: strings }) }, unknowns: strings, confidence });
const voice = object({ argument: text, blockers: strings, evidenceIds: strings, confidence });
export const reviewSchema = object({ skeptic: voice, dreamer: voice, empath: voice });
