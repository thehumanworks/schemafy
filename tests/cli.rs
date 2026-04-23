use std::fs;
use std::path::PathBuf;

use assert_cmd::Command;
use predicates::prelude::*;
use serde_json::Value;

fn run_schemafy(args: &[&str]) -> assert_cmd::assert::Assert {
    let mut command = Command::cargo_bin("schemafy").unwrap();
    command.args(args).assert()
}

fn parse_json(output: &[u8]) -> Value {
    serde_json::from_slice(output).unwrap()
}

#[test]
fn raw_output_builds_a_strict_schema_with_nullable_fields() {
    let output = run_schemafy(&[
        "--raw",
        "--name",
        "Person",
        "--field",
        "name=string",
        "--field",
        "age=int?",
    ])
    .success()
    .get_output()
    .stdout
    .clone();

    let schema = parse_json(&output);
    assert_eq!(schema["title"], "Person");
    assert_eq!(schema["type"], "object");
    assert_eq!(schema["additionalProperties"], false);
    assert_eq!(schema["required"], serde_json::json!(["name", "age"]));
    assert_eq!(
        schema["properties"]["age"]["type"],
        serde_json::json!(["integer", "null"])
    );
}

#[test]
fn default_output_writes_schema_to_a_temp_file_and_prints_the_path() {
    let output = run_schemafy(&[
        "--name",
        "Person",
        "--field",
        "name=string",
        "--field",
        "tags=string[]",
    ])
    .success()
    .get_output()
    .stdout
    .clone();

    let path = PathBuf::from(String::from_utf8(output).unwrap().trim());
    assert!(path.exists(), "expected schema file at {:?}", path);
    let schema: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(schema["properties"]["tags"]["type"], "array");
    let _ = fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn nested_objects_and_arrays_remain_strict() {
    let output = run_schemafy(&[
        "--raw",
        "--name",
        "Event",
        "--field",
        "title=string",
        "--field",
        "attendees=array<{name:string,email:string?}>",
    ])
    .success()
    .get_output()
    .stdout
    .clone();

    let schema = parse_json(&output);
    let attendee = &schema["properties"]["attendees"]["items"];
    assert_eq!(attendee["type"], "object");
    assert_eq!(attendee["additionalProperties"], false);
    assert_eq!(attendee["required"], serde_json::json!(["name", "email"]));
    assert_eq!(
        attendee["properties"]["email"]["type"],
        serde_json::json!(["string", "null"])
    );
}

#[test]
fn field_level_unions_render_as_anyof() {
    let output = run_schemafy(&["--raw", "--name", "Lookup", "--field", "value=string|int"])
        .success()
        .get_output()
        .stdout
        .clone();

    let schema = parse_json(&output);
    assert!(schema.get("anyOf").is_none());
    assert_eq!(schema["properties"]["value"]["anyOf"][0]["type"], "string");
    assert_eq!(schema["properties"]["value"]["anyOf"][1]["type"], "integer");
}

#[test]
fn string_literal_unions_render_as_json_schema_enums() {
    let output = run_schemafy(&[
        "--raw",
        "--name",
        "Review",
        "--field",
        "confidence=\"low\"|\"medium\"|\"high\"",
    ])
    .success()
    .get_output()
    .stdout
    .clone();

    let schema = parse_json(&output);
    let confidence = &schema["properties"]["confidence"];
    assert!(confidence.get("anyOf").is_none());
    assert_eq!(confidence["type"], "string");
    assert_eq!(
        confidence["enum"],
        serde_json::json!(["low", "medium", "high"])
    );
}

#[test]
fn nullable_string_enums_render_as_anyof_enum_and_null() {
    let output = run_schemafy(&[
        "--raw",
        "--name",
        "Review",
        "--field",
        "confidence=\"low\"|\"medium\"|null",
    ])
    .success()
    .get_output()
    .stdout
    .clone();

    let schema = parse_json(&output);
    let confidence = &schema["properties"]["confidence"];
    assert_eq!(confidence["anyOf"][0]["type"], "string");
    assert_eq!(
        confidence["anyOf"][0]["enum"],
        serde_json::json!(["low", "medium"])
    );
    assert_eq!(confidence["anyOf"][1]["type"], "null");
}

#[test]
fn nested_string_enums_render_inside_arrays_and_objects() {
    let output = run_schemafy(&[
        "--raw",
        "--name",
        "Review",
        "--field",
        "history=array<\"low\"|\"medium\">",
        "--field",
        "meta={confidence:\"low\"|\"medium\"}",
    ])
    .success()
    .get_output()
    .stdout
    .clone();

    let schema = parse_json(&output);
    assert_eq!(
        schema["properties"]["history"]["items"]["enum"],
        serde_json::json!(["low", "medium"])
    );
    assert_eq!(schema["properties"]["history"]["items"]["type"], "string");
    assert_eq!(schema["properties"]["meta"]["type"], "object");
    assert_eq!(schema["properties"]["meta"]["additionalProperties"], false);
    assert_eq!(
        schema["properties"]["meta"]["properties"]["confidence"]["enum"],
        serde_json::json!(["low", "medium"])
    );
}

#[test]
fn quoted_enum_members_and_defaults_preserve_delimiters() {
    let output = run_schemafy(&[
        "--raw",
        "--name",
        "Config",
        "--field",
        "token={\"a|b\"|\"c:-d\":-\"c:-d\"}",
        "--field",
        "note={string:-\"a:-b|c\"}",
        "--field",
        "levels={array<\"low\"|\"medium\">:-[\"low\",\"medium\"]}",
    ])
    .success()
    .get_output()
    .stdout
    .clone();

    let schema = parse_json(&output);
    assert_eq!(
        schema["properties"]["token"]["enum"],
        serde_json::json!(["a|b", "c:-d"])
    );
    assert_eq!(schema["properties"]["token"]["default"], "c:-d");
    assert_eq!(schema["properties"]["note"]["default"], "a:-b|c");
    assert_eq!(
        schema["properties"]["levels"]["items"]["enum"],
        serde_json::json!(["low", "medium"])
    );
    assert_eq!(
        schema["properties"]["levels"]["default"],
        serde_json::json!(["low", "medium"])
    );
}

#[test]
fn invalid_type_syntax_exits_with_an_error() {
    run_schemafy(&["--name", "Broken", "--field", "value=array<string"])
        .failure()
        .stderr(predicate::str::contains("expected '>' to close array type"));
}

#[test]
fn types_command_prints_available_types_and_default_syntax() {
    run_schemafy(&["types"])
        .success()
        .stdout(predicate::str::contains("Available types"))
        .stdout(predicate::str::contains("\"a\"|\"b\"|\"c\""))
        .stdout(predicate::str::contains("String enum via JSON Schema enum"))
        .stdout(predicate::str::contains("name={string:-codex}"))
        .stdout(predicate::str::contains("--raw"))
        .stdout(predicate::str::contains("array<T>"));
}

#[test]
fn main_help_lists_types_as_an_auxiliary_command() {
    run_schemafy(&["--help"])
        .success()
        .stdout(predicate::str::contains("types"))
        .stdout(predicate::str::contains("Auxiliary Commands"));
}

#[test]
fn shell_style_defaults_are_included_in_schema() {
    let output = run_schemafy(&[
        "--raw",
        "--name",
        "Config",
        "--field",
        "name={string:-codex}",
        "--field",
        "retries={int:-3}",
        "--field",
        "enabled={bool:-true}",
    ])
    .success()
    .get_output()
    .stdout
    .clone();

    let schema = parse_json(&output);
    assert_eq!(schema["properties"]["name"]["default"], "codex");
    assert_eq!(schema["properties"]["retries"]["default"], 3);
    assert_eq!(schema["properties"]["enabled"]["default"], true);
}

#[test]
fn enum_defaults_are_included_and_must_match_members() {
    let output = run_schemafy(&[
        "--raw",
        "--name",
        "Review",
        "--field",
        "confidence={\"low\"|\"medium\"|\"high\":-medium}",
    ])
    .success()
    .get_output()
    .stdout
    .clone();

    let schema = parse_json(&output);
    assert_eq!(schema["properties"]["confidence"]["default"], "medium");
    assert_eq!(
        schema["properties"]["confidence"]["enum"],
        serde_json::json!(["low", "medium", "high"])
    );

    run_schemafy(&[
        "--name",
        "Broken",
        "--field",
        "confidence={\"low\"|\"medium\":-urgent}",
    ])
    .failure()
    .stderr(predicate::str::contains("default value"))
    .stderr(predicate::str::contains("\"low\"|\"medium\""));
}

#[test]
fn invalid_default_for_type_exits_with_an_error() {
    run_schemafy(&["--name", "Broken", "--field", "age={int:-codex}"])
        .failure()
        .stderr(predicate::str::contains("default value"))
        .stderr(predicate::str::contains("integer"));
}
