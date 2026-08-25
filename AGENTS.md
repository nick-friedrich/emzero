# Repository guidance

## Code map

> **Notice:** Read [`.ai/index.md`](.ai/index.md) before changing the application. It is the repository's code map: use it to find the owning module for a feature, and update it in the same change whenever responsibilities or files move.

## Deciding when to split code

Organize code around cohesive features and responsibilities, not an arbitrary one-component-per-file rule.

Split a module when one or more of these are true:

- A section owns a distinct workflow, state, side effects, or UI surface (for example, the sidebar, composer, search, or account setup).
- The section can be named clearly and its public boundary is smaller than its implementation.
- The code changes for different reasons or is likely to be worked on independently.
- Extraction makes the behavior practical to test or lets another feature reuse it.
- Navigating or reviewing the module requires repeatedly jumping across unrelated concerns.

Keep code together when it implements one small, tightly coupled behavior and extracting it would mostly create forwarding props, circular imports, or vague “utils” modules. Prefer a few cohesive feature modules over many tiny files.

Line count is a review signal, not the deciding rule. Review a file once it grows beyond roughly 500–700 lines. A file over 1,000 lines should normally be split unless it is generated code or has a documented reason to remain together.

When splitting:

1. Preserve state ownership at the narrowest shared parent; do not introduce global state merely to move JSX into another file.
2. Extract leaf components and clear feature boundaries before inventing shared abstractions.
3. Keep feature-specific helpers with the feature. Move code to shared modules only after there is a real second consumer.
4. Avoid barrel files unless they provide a deliberate stable public API.
5. Make structural moves separately from behavior changes where practical, and run `pnpm check` afterward.
6. Update [`.ai/index.md`](.ai/index.md) when a file is added, removed, renamed, or takes ownership of a responsibility.
