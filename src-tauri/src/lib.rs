mod file_browser;
mod video_tools;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .invoke_handler(tauri::generate_handler![
      file_browser::list_roots,
      file_browser::list_directory,
      file_browser::collect_images_from_directory,
      file_browser::filter_folders_with_images,
      video_tools::video_tools_status,
      video_tools::probe_video,
      video_tools::prepare_video,
      video_tools::get_video_thumbnail
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
