# schemafy

`schemafy` is a small Rust CLI that generates OpenAI Structured Outputs compatible JSON Schema from repeated `--field` definitions.

## Build

```bash
cargo build --manifest-path schemafy/Cargo.toml --release
```

The binary is:

```bash
./schemafy/target/release/schemafy
```

## Usage

Print raw schema JSON:

```bash
./schemafy/target/release/schemafy \
  --raw \
  --name Person \
  --field 'name=string' \
  --field 'age=int?'
```

Print the built-in type/config reference:

```bash
./schemafy/target/release/schemafy types
```

Write the schema to a temp file and print the path:

```bash
./schemafy/target/release/schemafy \
  --name Event \
  --field 'title=string' \
  --field 'attendees=array<{name:string,email:string?}>'
```

## Type DSL

- `string`, `str`
- `number`, `float`
- `integer`, `int`
- `boolean`, `bool`
- `null`
- `T?` for nullable fields
- `T[]` or `array<T>` for arrays
- `{field:type,...}` or `object{field:type,...}` for explicit nested objects
- `A|B` for field-level unions
- `{TYPE:-value}` for shell-style field defaults

Examples:

- `name=string`
- `age=int?`
- `tags=string[]`
- `address={city:string,zip:int}`
- `value=string|int`
- `name={string:-codex}`
- `retries={int:-3}`
- `enabled={bool:-true}`

## Notes

- The generated root schema is always a strict object with every field in `required`.
- Nullable fields are represented as unions with `null`.
- Field defaults are emitted as JSON Schema `default`.
- Generated objects always set `additionalProperties: false`.
- Arbitrary free-form object maps are intentionally not supported because OpenAI Structured Outputs requires explicit object keys in strict schemas.
