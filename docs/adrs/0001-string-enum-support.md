# ADR 0001: Represent string literal unions as JSON Schema enums

- Status: Accepted
- Date: 2026-04-23

## Context

`schemafy` already supports primitive types, nested objects, arrays, nullable values, unions, and field defaults.

Users also need TypeScript-style string literal unions such as:

```bash
--field 'confidence="low"|"medium"|"high"'
```

Those values describe a closed set of allowed strings. Emitting them as a generic `anyOf` union would work, but it is noisier than necessary and loses the stronger intent that the field is a string enum.

## Decision

`schemafy` will treat a union made entirely of quoted string literals as a first-class string enum.

### Syntax

String enum members are written as JSON-style double-quoted string literals joined with `|`:

```text
"low"|"medium"|"high"
```

### Schema output

A pure string-literal union is emitted as:

```json
{
  "type": "string",
  "enum": ["low", "medium", "high"]
}
```

If the enum is combined with non-string members, `schemafy` keeps the union explicit with `anyOf`.

For example:

```text
"low"|"medium"|null
```

becomes an `anyOf` with a string enum branch and a `null` branch.

### Defaults

Defaults for string enums must match one of the declared enum members.

Defaults remain JSON Schema annotations only. They do not make fields optional; root fields are still emitted in `required`.

## Consequences

- The DSL now supports TypeScript-like string literal unions directly.
- Pure string-literal unions generate smaller, clearer JSON Schema.
- Mixed unions preserve the existing `anyOf` behavior.
- The parser must remain quote-aware when splitting `{TYPE:-default}` wrappers.

## Invariants

The following behavior is treated as stable and enforced by automated tests:

1. A field whose type is only quoted string literals is emitted as `type: "string"` plus `enum`.
2. A string enum combined with `null` is emitted as `anyOf` with an enum branch and a null branch.
3. Enum defaults must be one of the declared enum members.
4. The `schemafy types` output documents string enum syntax.
