// build.rs
use deno_core::ModuleCodeString;
use deno_core::ModuleName;
use deno_core::extension;
use deno_error::JsErrorBox;
use std::env;
use std::path::PathBuf;
use std::rc::Rc;

extension!(
    nm_runjs,
    esm = [ dir "src", "nm_runjs.ts" ],
);

fn main() {
  let out_dir = PathBuf::from(env::var_os("OUT_DIR").unwrap());
  let snapshot_path = out_dir.join("nm_runjs.bin");

  let snapshot_output = deno_core::snapshot::create_snapshot(
    deno_core::snapshot::CreateSnapshotOptions {
      cargo_manifest_dir: env!("CARGO_MANIFEST_DIR"),
      startup_snapshot: None,
      skip_op_registration: false,
      extensions: vec![nm_runjs::init()],
      with_runtime_cb: None,

      extension_transpiler: Some(Rc::new(
        |specifier: ModuleName, source: ModuleCodeString| {
          use deno_ast::{MediaType, ParseParams};

          let path = PathBuf::from(specifier.as_str());
          let media_type = MediaType::from_path(&path);

          match media_type {
            MediaType::TypeScript | MediaType::Mts | MediaType::Cts | MediaType::Tsx => {
              let source_str: String = source.as_str().to_string();

              let parsed = deno_ast::parse_module(ParseParams {
                specifier: deno_core::ModuleSpecifier::parse(specifier.as_str()).unwrap(),
                text: source_str.into(),
                media_type,
                capture_tokens: false,
                scope_analysis: false,
                maybe_syntax: None,
              })
              .map_err(|e| JsErrorBox::generic(format!("TypeScript Parse Error: {}", e)))?;

              let transpiled = parsed
                .transpile(
                  &Default::default(),
                  &Default::default(),
                  &Default::default(),
                )
                .map_err(|e| JsErrorBox::generic(format!("TypeScript Transpilation Error: {}", e)))?
                .into_source();

              Ok((transpiled.text.into(), None))
            }
            _ => Ok((source, None)),
          }
        },
      )),
    },
    None,
  )
  .unwrap();

  std::fs::write(snapshot_path, snapshot_output.output).unwrap();

  println!("cargo:rerun-if-changed=build.rs");
  println!("cargo:rerun-if-changed=src/nm_runjs.ts");
}
