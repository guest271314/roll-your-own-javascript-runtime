//! deno_core TypeScript/JavaScript Native Messaging host
//! https://github.com/denoland/roll-your-own-javascript-runtime
//! https://github.com/guest271314/roll-your-own-javascript-runtime
//! guest271314 9-20-2026

use deno_ast::MediaType;
use deno_ast::ParseParams;
use deno_core::error::AnyError;
use deno_core::error::ModuleLoaderError;
use deno_core::{
  AsyncResult, BufMutView, BufView, ModuleLoadResponse, ModuleSourceCode, Resource, WriteOutcome,
};
use deno_error::JsErrorBox;
use std::io::{self, Read, Write};
use std::rc::Rc;
// use std::env;

// 1. Dual-Format Polyvalent Module Loader
struct JsTsModuleLoaderModuleLoader {
  embedded_code: &'static str,
  is_typescript: bool,
}

impl deno_core::ModuleLoader for JsTsModuleLoaderModuleLoader {
  fn resolve(
    &self,
    specifier: &str,
    referrer: &str,
    _kind: deno_core::ResolutionKind,
  ) -> Result<deno_core::ModuleSpecifier, ModuleLoaderError> {
    deno_core::resolve_import(specifier, referrer).map_err(|e| JsErrorBox::from_err(e))
  }

  fn load(
    &self,
    module_specifier: &deno_core::ModuleSpecifier,
    _maybe_referrer: Option<&deno_core::ModuleLoadReferrer>,
    _options: deno_core::ModuleLoadOptions,
  ) -> ModuleLoadResponse {
    let module_specifier = module_specifier.clone();
    let embedded_code = self.embedded_code;
    let is_typescript = self.is_typescript;

    let module_load = move || {
      let specifier_str = module_specifier.as_str();

      // Determine if loading the embedded asset or a fallback local filesystem module
      let (code, media_type) =
        if specifier_str == "file:///main.ts" || specifier_str == "file:///main.js" {
          let detected_media = if is_typescript {
            MediaType::TypeScript
          } else {
            MediaType::JavaScript
          };
          (embedded_code.to_string(), detected_media)
        } else {
          let path = module_specifier.to_file_path().map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidInput, "Invalid file path specifier")
          })?;
          let file_content = std::fs::read_to_string(&path)?;
          let detected_type = MediaType::from_path(&path);
          (file_content, detected_type)
        };

      let (module_type, should_transpile) = match media_type {
        MediaType::JavaScript | MediaType::Mjs | MediaType::Cjs => {
          (deno_core::ModuleType::JavaScript, false)
        }
        MediaType::Jsx => (deno_core::ModuleType::JavaScript, true),
        MediaType::TypeScript
        | MediaType::Mts
        | MediaType::Cts
        | MediaType::Dts
        | MediaType::Dmts
        | MediaType::Dcts
        | MediaType::Tsx => (deno_core::ModuleType::JavaScript, true),
        MediaType::Json => (deno_core::ModuleType::Json, false),
        _ => {
          return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            format!("Unsupported media type for specifier: {}", specifier_str),
          ));
        }
      };

      let final_code = if should_transpile {
        let parsed = deno_ast::parse_module(ParseParams {
          specifier: module_specifier.clone(),
          text: code.into(),
          media_type,
          capture_tokens: false,
          scope_analysis: false,
          maybe_syntax: None,
        })
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;

        parsed
          .transpile(
            &Default::default(),
            &Default::default(),
            &Default::default(),
          )
          .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?
          .into_source()
          .text
      } else {
        code
      };

      let module = deno_core::ModuleSource::new(
        module_type,
        ModuleSourceCode::String(final_code.into()),
        &module_specifier,
        None,
      );
      Ok(module)
    };

    match module_load() {
      Ok(source) => ModuleLoadResponse::Sync(Ok(source)),
      Err(err) => ModuleLoadResponse::Sync(Err(JsErrorBox::from_err(err))),
    }
  }
}

// 2. Standard Streams I/O Resource Registries
struct StdinResource;
impl Resource for StdinResource {
  fn name(&self) -> std::borrow::Cow<'_, str> {
    "stdin".into()
  }
  fn read_byob(self: Rc<Self>, mut buf: BufMutView) -> AsyncResult<(usize, BufMutView)> {
    Box::pin(async move {
      let mut stdin = io::stdin().lock();
      let nread = match stdin.read(&mut buf) {
        Ok(n) => n,
        Err(_) => 0,
      };
      Ok((nread, buf))
    })
  }
}

struct StdoutResource;
impl Resource for StdoutResource {
  fn name(&self) -> std::borrow::Cow<'_, str> {
    "stdout".into()
  }
  fn write(self: Rc<Self>, buf: BufView) -> AsyncResult<WriteOutcome> {
    let mut stdout = io::stdout().lock();
    let nwritten = buf.len();
    let _ = stdout.write_all(&buf);
    let _ = stdout.flush();
    Box::pin(std::future::ready(Ok(WriteOutcome::Full { nwritten })))
  }
}

struct StderrResource;
impl Resource for StderrResource {
  fn name(&self) -> std::borrow::Cow<'_, str> {
    "stderr".into()
  }
  fn write(self: Rc<Self>, buf: BufView) -> AsyncResult<WriteOutcome> {
    let mut stderr = io::stderr().lock();
    let nwritten = buf.len();
    let _ = stderr.write_all(&buf);
    let _ = stderr.flush();
    Box::pin(std::future::ready(Ok(WriteOutcome::Full { nwritten })))
  }
}
/// TODO: Execute only snapshot
// static RUNTIME_SNAPSHOT: &[u8] =
//   include_bytes!(concat!(env!("OUT_DIR"), "/nm_runjs.bin"));

// 3. Main runtime bootstrapper
async fn run_js(embedded_code: &'static str, filename: &str) -> Result<(), AnyError> {
  let is_typescript = filename.ends_with(".ts");
  let loader = Rc::new(JsTsModuleLoaderModuleLoader {
    embedded_code,
    is_typescript,
  });

  let mut js_runtime = deno_core::JsRuntime::new(deno_core::RuntimeOptions {
    module_loader: Some(loader),
    startup_snapshot: None, // Some(RUNTIME_SNAPSHOT),
    ..Default::default()
  });

  let op_state = js_runtime.op_state();
  let mut state = op_state.borrow_mut();
  state.resource_table.add(StdinResource);
  state.resource_table.add(StdoutResource);
  state.resource_table.add(StderrResource);
  drop(state);

  // Dynamic routing based on embedded file type extension matches
  let virtual_url = if is_typescript {
    "file:///main.ts"
  } else {
    "file:///main.js"
  };
  let specifier = deno_core::ModuleSpecifier::parse(virtual_url).unwrap();

  let mod_id = js_runtime.load_main_es_module(&specifier).await?;
  let evaluation = js_runtime.mod_evaluate(mod_id);

  js_runtime.run_event_loop(Default::default()).await?;

  evaluation.await?;
  Ok(())
}

fn main() {
  // Point this to your script path asset target. It works for both .js and .ts extensions.
  const FILENAME: &str = "nm_runjs.ts";
  let code = include_str!("nm_runjs.ts");
  // let code = include_str!("nm_runjs.js");
  // let code = r#"..."#;

  let runtime = tokio::runtime::Builder::new_current_thread()
    .enable_all()
    .build()
    .unwrap();

  if let Err(error) = runtime.block_on(run_js(code, FILENAME)) {
    eprintln!("error: {}", error);
  }
}
