use clap::{Args, Parser, Subcommand};
use schemafy::{
    build_root_schema, parse_field_spec, render_schema, types_help, write_schema_to_temp_file,
};

#[derive(Debug, Parser)]
#[command(
    name = "schemafy",
    version,
    about = "Generate an OpenAI Structured Outputs compatible JSON schema from repeated --field specs.",
    args_conflicts_with_subcommands = true,
    subcommand_negates_reqs = true,
    subcommand_help_heading = "Auxiliary Commands"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,

    #[command(flatten)]
    generate: GenerateArgs,
}

#[derive(Debug, Subcommand)]
enum Command {
    #[command(about = "Print available types and config.")]
    Types,
}

#[derive(Debug, Args)]
struct GenerateArgs {
    #[arg(short, long, value_name = "NAME", required = true)]
    name: Option<String>,

    #[arg(
        long,
        help = "Print the schema JSON instead of writing it to a temp file."
    )]
    raw: bool,

    #[arg(
        long = "field",
        required = true,
        value_name = "NAME=TYPE",
        help = "Add a field like name=string, age=int?, or address={city:string,zip:int}."
    )]
    fields: Vec<String>,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("schemafy: {error}");
        std::process::exit(1);
    }
}

fn run() -> schemafy::Result<()> {
    let cli = Cli::parse();
    if matches!(cli.command, Some(Command::Types)) {
        print!("{}", types_help());
        return Ok(());
    }

    let fields = cli
        .generate
        .fields
        .iter()
        .map(|field| parse_field_spec(field))
        .collect::<schemafy::Result<Vec<_>>>()?;

    let schema = build_root_schema(
        cli.generate
            .name
            .as_deref()
            .expect("clap should require --name unless a subcommand is used"),
        &fields,
    );
    if cli.generate.raw {
        println!("{}", render_schema(&schema)?);
        return Ok(());
    }

    let output_path = write_schema_to_temp_file(
        cli.generate
            .name
            .as_deref()
            .expect("clap should require --name unless a subcommand is used"),
        &schema,
    )?;
    println!("{}", output_path.display());
    Ok(())
}
