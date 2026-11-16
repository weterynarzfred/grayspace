fn main() {
  // tauri-build only embeds the app manifest into the app binary. The test binary also links
  // comctl32's TaskDialogIndirect (Tauri's common-controls-v6 error dialog) and fails to start
  // without it, so the same manifest is embedded through the linker for every target instead.
  let windows_attributes = tauri_build::WindowsAttributes::new_without_app_manifest();
  tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows_attributes))
    .expect("failed to run tauri-build");

  if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
    let manifest_path = std::env::current_dir()
      .expect("build script should know its directory")
      .join("windows-app-manifest.xml");
    println!("cargo:rerun-if-changed=windows-app-manifest.xml");
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest_path.display());
  }
}
