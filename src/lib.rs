use std::fs;
use std::path::PathBuf;
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{fmt, io};

use serde_json::{Map, Value};

pub type Result<T> = std::result::Result<T, SchemafyError>;

#[derive(Debug, Clone, PartialEq)]
pub struct Field {
    pub name: String,
    pub ty: TypeExpr,
    pub default: Option<Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TypeExpr {
    Primitive(PrimitiveType),
    Array(Box<TypeExpr>),
    Object(Vec<Field>),
    Union(Vec<TypeExpr>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PrimitiveType {
    String,
    Number,
    Integer,
    Boolean,
    Null,
}

impl PrimitiveType {
    fn json_type(self) -> &'static str {
        match self {
            Self::String => "string",
            Self::Number => "number",
            Self::Integer => "integer",
            Self::Boolean => "boolean",
            Self::Null => "null",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemafyError(String);

impl SchemafyError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for SchemafyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for SchemafyError {}

impl From<io::Error> for SchemafyError {
    fn from(error: io::Error) -> Self {
        Self::new(error.to_string())
    }
}

impl TypeExpr {
    fn normalized(self) -> Self {
        match self {
            Self::Array(item) => Self::Array(Box::new(item.normalized())),
            Self::Object(fields) => Self::Object(
                fields
                    .into_iter()
                    .map(|field| Field {
                        name: field.name,
                        ty: field.ty.normalized(),
                        default: field.default,
                    })
                    .collect(),
            ),
            Self::Union(members) => {
                let mut normalized = Vec::new();
                for member in members.into_iter().map(Self::normalized) {
                    match member {
                        Self::Union(nested) => normalized.extend(nested),
                        other => normalized.push(other),
                    }
                }
                Self::Union(normalized)
            }
            primitive => primitive,
        }
    }
}

pub fn parse_field_spec(spec: &str) -> Result<Field> {
    let (name, raw_ty) = spec
        .split_once('=')
        .ok_or_else(|| SchemafyError::new(format!("field must look like name=type: {spec}")))?;
    let name = name.trim();
    if name.is_empty() {
        return Err(SchemafyError::new(format!(
            "field name cannot be empty in spec: {spec}"
        )));
    }

    let (ty_source, default_source) = split_default_wrapper(raw_ty.trim());
    let ty = parse_type_expr(ty_source)?;
    let default = default_source
        .map(|source| parse_default_value(&ty, source))
        .transpose()?;

    Ok(Field {
        name: name.to_string(),
        ty,
        default,
    })
}

pub fn parse_type_expr(input: &str) -> Result<TypeExpr> {
    let mut parser = Parser::new(input);
    let ty = parser.parse_union()?.normalized();
    parser.skip_ws();
    if parser.is_eof() {
        Ok(ty)
    } else {
        Err(parser.error("unexpected trailing input"))
    }
}

pub fn build_root_schema(name: &str, fields: &[Field]) -> Value {
    object_schema(fields, Some(name))
}

pub fn render_schema(schema: &Value, pretty: bool) -> Result<String> {
    if pretty {
        serde_json::to_string_pretty(schema)
            .map_err(|error| SchemafyError::new(format!("failed to render schema: {error}")))
    } else {
        serde_json::to_string(schema)
            .map_err(|error| SchemafyError::new(format!("failed to render schema: {error}")))
    }
}

pub fn types_help() -> &'static str {
    r#"Available types

Primitives
  string, str
  integer, int
  number, float
  boolean, bool
  null

Containers
  T[]                  Array of T
  array<T>             Array of T
  {name:type,...}      Strict nested object
  object{...}          Strict nested object
  A|B                  Field-level union via anyOf
  T?                   Nullable T (same as T|null)

Defaults
  Use shell-style defaults on a field with:
    --field 'name={string:-codex}'
    --field 'retries={int:-3}'
    --field 'enabled={bool:-true}'

  Notes
    - Defaults are emitted as JSON Schema "default".
    - String defaults may be raw text or quoted.
    - Array/object defaults should be valid JSON.

Config
  --name NAME          Root schema title
  --field NAME=TYPE    Repeat for each field
  --raw                Print JSON to stdout
  default output       Write schema to a temp file and print its path

Examples
  schemafy --raw --name Person --field 'name=string' --field 'age=int?'
  schemafy --name Config --field 'name={string:-codex}'
  schemafy --field 'user={name:string,email:string?}' --name User
"#
}

pub fn write_schema_to_temp_file(name: &str, schema: &Value) -> Result<PathBuf> {
    let temp_dir = create_unique_temp_dir()?;
    let output_path = temp_dir.join(format!("{}.json", sanitize_file_name(name)));
    let rendered = render_schema(schema, true)?;
    fs::write(&output_path, format!("{rendered}\n"))?;
    Ok(output_path)
}

fn create_unique_temp_dir() -> Result<PathBuf> {
    let base = std::env::temp_dir();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| SchemafyError::new(format!("system clock error: {error}")))?
        .as_nanos();

    for attempt in 0..1024_u32 {
        let candidate = base.join(format!("schemafy-{}-{timestamp}-{attempt}", process::id()));
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }

    Err(SchemafyError::new(
        "failed to create a unique temp directory for schema output",
    ))
}

fn sanitize_file_name(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|char| match char {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' => char,
            _ => '-',
        })
        .collect();
    let trimmed = sanitized.trim_matches(['-', '.']);
    if trimmed.is_empty() {
        "schema".to_string()
    } else {
        trimmed.to_string()
    }
}

fn split_default_wrapper(input: &str) -> (&str, Option<&str>) {
    let trimmed = input.trim();
    if !trimmed.starts_with('{') || !trimmed.ends_with('}') {
        return (trimmed, None);
    }

    let inner = &trimmed[1..trimmed.len() - 1];
    let mut brace_depth = 0usize;
    let mut angle_depth = 0usize;
    let mut square_depth = 0usize;
    let chars: Vec<(usize, char)> = inner.char_indices().collect();
    let mut index = 0usize;

    while index < chars.len() {
        let (offset, ch) = chars[index];
        match ch {
            '{' => brace_depth += 1,
            '}' => brace_depth = brace_depth.saturating_sub(1),
            '<' => angle_depth += 1,
            '>' => angle_depth = angle_depth.saturating_sub(1),
            '[' => square_depth += 1,
            ']' => square_depth = square_depth.saturating_sub(1),
            ':' if brace_depth == 0 && angle_depth == 0 && square_depth == 0 => {
                if chars.get(index + 1).map(|(_, next)| *next) == Some('-') {
                    let ty = inner[..offset].trim();
                    let default = inner[offset + 2..].trim();
                    return (ty, Some(default));
                }
            }
            _ => {}
        }
        index += 1;
    }

    (trimmed, None)
}

fn parse_default_value(ty: &TypeExpr, source: &str) -> Result<Value> {
    try_parse_default_value(ty, source).ok_or_else(|| {
        SchemafyError::new(format!(
            "default value '{source}' does not match type {}",
            describe_type(ty)
        ))
    })
}

fn try_parse_default_value(ty: &TypeExpr, source: &str) -> Option<Value> {
    match ty {
        TypeExpr::Primitive(PrimitiveType::String) => {
            Some(Value::String(parse_string_default(source)))
        }
        TypeExpr::Primitive(PrimitiveType::Integer) => source.parse::<i64>().ok().map(Value::from),
        TypeExpr::Primitive(PrimitiveType::Number) => source
            .parse::<f64>()
            .ok()
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number),
        TypeExpr::Primitive(PrimitiveType::Boolean) => match source {
            "true" => Some(Value::Bool(true)),
            "false" => Some(Value::Bool(false)),
            _ => None,
        },
        TypeExpr::Primitive(PrimitiveType::Null) => (source == "null").then_some(Value::Null),
        TypeExpr::Array(_) | TypeExpr::Object(_) => {
            let value = serde_json::from_str::<Value>(source).ok()?;
            value_matches_type(ty, &value).then_some(value)
        }
        TypeExpr::Union(members) => {
            if source == "null" && members.contains(&TypeExpr::Primitive(PrimitiveType::Null)) {
                return Some(Value::Null);
            }

            if let Ok(value) = serde_json::from_str::<Value>(source)
                && members
                    .iter()
                    .any(|member| value_matches_type(member, &value))
            {
                return Some(value);
            }

            for member in members {
                if *member != TypeExpr::Primitive(PrimitiveType::String)
                    && let Some(value) = try_parse_default_value(member, source)
                {
                    return Some(value);
                }
            }

            for member in members {
                if *member == TypeExpr::Primitive(PrimitiveType::String)
                    && let Some(value) = try_parse_default_value(member, source)
                {
                    return Some(value);
                }
            }

            None
        }
    }
}

fn parse_string_default(source: &str) -> String {
    let trimmed = source.trim();
    if trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2 {
        serde_json::from_str::<String>(trimmed).unwrap_or_else(|_| trimmed.to_string())
    } else if trimmed.starts_with('\'') && trimmed.ends_with('\'') && trimmed.len() >= 2 {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
    }
}

fn value_matches_type(ty: &TypeExpr, value: &Value) -> bool {
    match ty {
        TypeExpr::Primitive(PrimitiveType::String) => value.is_string(),
        TypeExpr::Primitive(PrimitiveType::Integer) => value.as_i64().is_some(),
        TypeExpr::Primitive(PrimitiveType::Number) => value.as_f64().is_some(),
        TypeExpr::Primitive(PrimitiveType::Boolean) => value.is_boolean(),
        TypeExpr::Primitive(PrimitiveType::Null) => value.is_null(),
        TypeExpr::Array(item) => value
            .as_array()
            .is_some_and(|items| items.iter().all(|entry| value_matches_type(item, entry))),
        TypeExpr::Object(fields) => value.as_object().is_some_and(|object| {
            object.len() == fields.len()
                && fields.iter().all(|field| {
                    object
                        .get(&field.name)
                        .is_some_and(|entry| value_matches_type(&field.ty, entry))
                })
        }),
        TypeExpr::Union(members) => members
            .iter()
            .any(|member| value_matches_type(member, value)),
    }
}

fn describe_type(ty: &TypeExpr) -> String {
    match ty {
        TypeExpr::Primitive(primitive) => primitive.json_type().to_string(),
        TypeExpr::Array(item) => format!("array<{}>", describe_type(item)),
        TypeExpr::Object(fields) => format!(
            "object{{{}}}",
            fields
                .iter()
                .map(|field| format!("{}:{}", field.name, describe_type(&field.ty)))
                .collect::<Vec<_>>()
                .join(",")
        ),
        TypeExpr::Union(members) => members
            .iter()
            .map(describe_type)
            .collect::<Vec<_>>()
            .join("|"),
    }
}

fn object_schema(fields: &[Field], title: Option<&str>) -> Value {
    let mut schema = Map::new();
    schema.insert("type".into(), Value::String("object".into()));
    if let Some(title) = title {
        schema.insert("title".into(), Value::String(title.to_string()));
    }

    let mut properties = Map::new();
    let required = fields
        .iter()
        .map(|field| {
            properties.insert(
                field.name.clone(),
                type_schema(&field.ty, field.default.as_ref()),
            );
            Value::String(field.name.clone())
        })
        .collect();

    schema.insert("properties".into(), Value::Object(properties));
    schema.insert("required".into(), Value::Array(required));
    schema.insert("additionalProperties".into(), Value::Bool(false));
    Value::Object(schema)
}

fn type_schema(ty: &TypeExpr, default: Option<&Value>) -> Value {
    let mut schema = match ty {
        TypeExpr::Primitive(primitive) => {
            let mut schema = Map::new();
            schema.insert("type".into(), Value::String(primitive.json_type().into()));
            schema
        }
        TypeExpr::Array(item) => {
            let mut schema = Map::new();
            schema.insert("type".into(), Value::String("array".into()));
            schema.insert("items".into(), type_schema(item, None));
            schema
        }
        TypeExpr::Object(fields) => {
            let mut object = object_schema(fields, None)
                .as_object()
                .cloned()
                .unwrap_or_default();
            if let Some(default) = default {
                object.insert("default".into(), default.clone());
            }
            return Value::Object(object);
        }
        TypeExpr::Union(members) => {
            if let Some(schema) = primitive_nullable_schema(members) {
                if let Some(default) = default {
                    let mut object = schema.as_object().cloned().unwrap_or_default();
                    object.insert("default".into(), default.clone());
                    return Value::Object(object);
                }
                return schema;
            }

            let any_of = members
                .iter()
                .map(|member| type_schema(member, None))
                .collect();
            let mut schema = Map::new();
            schema.insert("anyOf".into(), Value::Array(any_of));
            schema
        }
    };

    if let Some(default) = default {
        schema.insert("default".into(), default.clone());
    }

    Value::Object(schema)
}

fn primitive_nullable_schema(members: &[TypeExpr]) -> Option<Value> {
    if members.len() != 2 {
        return None;
    }

    let mut primitive = None;
    let mut saw_null = false;

    for member in members {
        match member {
            TypeExpr::Primitive(PrimitiveType::Null) => saw_null = true,
            TypeExpr::Primitive(other) => primitive = Some(*other),
            _ => return None,
        }
    }

    let primitive = primitive?;
    if !saw_null || primitive == PrimitiveType::Null {
        return None;
    }

    Some(Value::Object(Map::from_iter([(
        "type".into(),
        Value::Array(vec![
            Value::String(primitive.json_type().into()),
            Value::String(PrimitiveType::Null.json_type().into()),
        ]),
    )])))
}

struct Parser<'a> {
    input: &'a str,
    offset: usize,
}

impl<'a> Parser<'a> {
    fn new(input: &'a str) -> Self {
        Self { input, offset: 0 }
    }

    fn parse_union(&mut self) -> Result<TypeExpr> {
        let mut members = vec![self.parse_postfix()?];
        loop {
            self.skip_ws();
            if !self.consume_char('|') {
                break;
            }
            members.push(self.parse_postfix()?);
        }

        if members.len() == 1 {
            Ok(members.pop().unwrap())
        } else {
            Ok(TypeExpr::Union(members))
        }
    }

    fn parse_postfix(&mut self) -> Result<TypeExpr> {
        let mut ty = self.parse_primary()?;
        loop {
            self.skip_ws();
            if self.consume_char('?') {
                ty = TypeExpr::Union(vec![ty, TypeExpr::Primitive(PrimitiveType::Null)]);
                continue;
            }

            if self.consume_str("[]") {
                ty = TypeExpr::Array(Box::new(ty));
                continue;
            }

            break;
        }
        Ok(ty)
    }

    fn parse_primary(&mut self) -> Result<TypeExpr> {
        self.skip_ws();
        if self.consume_char('{') {
            return self.parse_object_body();
        }

        let identifier = self
            .parse_identifier()
            .ok_or_else(|| self.error("expected a type"))?;

        match identifier.as_str() {
            "array" => {
                self.skip_ws();
                self.expect_char('<', "expected '<' after array")?;
                let item = self.parse_union()?;
                self.skip_ws();
                self.expect_char('>', "expected '>' to close array type")?;
                Ok(TypeExpr::Array(Box::new(item)))
            }
            "object" => {
                self.skip_ws();
                if self.consume_char('{') {
                    self.parse_object_body()
                } else {
                    Ok(TypeExpr::Object(Vec::new()))
                }
            }
            "string" | "str" => Ok(TypeExpr::Primitive(PrimitiveType::String)),
            "number" | "float" => Ok(TypeExpr::Primitive(PrimitiveType::Number)),
            "integer" | "int" => Ok(TypeExpr::Primitive(PrimitiveType::Integer)),
            "boolean" | "bool" => Ok(TypeExpr::Primitive(PrimitiveType::Boolean)),
            "null" => Ok(TypeExpr::Primitive(PrimitiveType::Null)),
            other => Err(self.error(format!("unknown type '{other}'"))),
        }
    }

    fn parse_object_body(&mut self) -> Result<TypeExpr> {
        let mut fields = Vec::new();
        self.skip_ws();
        if self.consume_char('}') {
            return Ok(TypeExpr::Object(fields));
        }

        loop {
            let name = self
                .parse_field_name()
                .ok_or_else(|| self.error("expected an object field name"))?;
            self.skip_ws();
            self.expect_char(':', "expected ':' after object field name")?;
            let ty = self.parse_union()?;
            fields.push(Field {
                name,
                ty,
                default: None,
            });
            self.skip_ws();

            if self.consume_char(',') {
                continue;
            }

            self.expect_char('}', "expected ',' or '}' after object field")?;
            break;
        }

        Ok(TypeExpr::Object(fields))
    }

    fn parse_identifier(&mut self) -> Option<String> {
        self.skip_ws();
        let start = self.offset;
        while let Some(char) = self.peek_char() {
            if char.is_ascii_alphanumeric() || char == '_' {
                self.bump_char();
            } else {
                break;
            }
        }

        if self.offset == start {
            None
        } else {
            Some(self.input[start..self.offset].to_string())
        }
    }

    fn parse_field_name(&mut self) -> Option<String> {
        self.skip_ws();
        let start = self.offset;
        while let Some(char) = self.peek_char() {
            if matches!(
                char,
                ':' | ',' | '}' | '{' | '<' | '>' | '|' | '?' | '[' | ']'
            ) || char.is_whitespace()
            {
                break;
            }
            self.bump_char();
        }

        if self.offset == start {
            None
        } else {
            Some(self.input[start..self.offset].to_string())
        }
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek_char(), Some(char) if char.is_whitespace()) {
            self.bump_char();
        }
    }

    fn expect_char(&mut self, expected: char, message: impl Into<String>) -> Result<()> {
        if self.consume_char(expected) {
            Ok(())
        } else {
            Err(self.error(message))
        }
    }

    fn consume_char(&mut self, expected: char) -> bool {
        if self.peek_char() == Some(expected) {
            self.bump_char();
            true
        } else {
            false
        }
    }

    fn consume_str(&mut self, expected: &str) -> bool {
        if self.input[self.offset..].starts_with(expected) {
            self.offset += expected.len();
            true
        } else {
            false
        }
    }

    fn peek_char(&self) -> Option<char> {
        self.input[self.offset..].chars().next()
    }

    fn bump_char(&mut self) {
        if let Some(char) = self.peek_char() {
            self.offset += char.len_utf8();
        }
    }

    fn is_eof(&self) -> bool {
        self.offset >= self.input.len()
    }

    fn error(&self, message: impl Into<String>) -> SchemafyError {
        SchemafyError::new(format!("{} at byte {}", message.into(), self.offset))
    }
}
