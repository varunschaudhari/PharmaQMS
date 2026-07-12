import type { PermissionKey } from './enums/permission';

// Session 19 hardening pass: `POST /workflow/instances/submit` is a generic, entity-agnostic PLT-4
// endpoint reachable by any authenticated tenant user. Without this map, a caller holding zero
// permission on (e.g.) the Documents module could submit a DocumentVersion into its approval
// workflow directly through this endpoint, bypassing DOC-3's `documents:edit`-gated
// `POST /documents/:id/versions/:versionId/submit` wrapper entirely (that wrapper calls
// `WorkflowService.submit()` in-process, but nothing stopped a caller from reaching the same
// service method straight from the generic HTTP surface). Plain string keys here (not an import of
// a business module's entity-type constant) keep this platform-level file free of any dependency
// on `server/src/modules/*` — CLAUDE.md's "business modules never depend on each other" extends to
// platform services never depending on a specific business module either.
// entityTypes not listed here (e.g. the throwaway TestRecord demo, whose own controller comment
// says "submission goes through the generic PLT-4 endpoints") need only authentication, matching
// their existing, unchanged behavior — this map is additive, not a behavior change for anything else.
export const WORKFLOW_SUBMIT_ENTITY_TYPE_PERMISSION: Readonly<Record<string, PermissionKey>> = {
  DocumentVersion: 'documents:edit',
};
