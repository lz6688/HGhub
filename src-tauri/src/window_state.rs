use serde::{Deserialize, Serialize};
use std::{io, path::PathBuf, sync::Mutex};
use tauri::{LogicalSize, Manager, Window, WindowEvent};

#[derive(Serialize, Deserialize)]
struct Geometry {
    width: f64,
    height: f64,
    maximized: bool,
}

struct WindowState {
    path: PathBuf,
    geometry: Mutex<Geometry>,
}

pub fn restore(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .expect("main window is created before restoring its size");
    let path = app.path().app_data_dir()?.join("window.json");
    let current = window
        .inner_size()?
        .to_logical::<f64>(window.scale_factor()?);
    let mut geometry = Geometry {
        width: current.width,
        height: current.height,
        maximized: false,
    };
    let loaded = (|| -> Result<Option<Geometry>, Box<dyn std::error::Error>> {
        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let saved: Geometry = serde_json::from_slice(&bytes)?;
        if !saved.width.is_finite()
            || !saved.height.is_finite()
            || saved.width <= 0.0
            || saved.height <= 0.0
        {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "窗口尺寸无效").into());
        }
        Ok(Some(saved))
    })();
    match loaded {
        Ok(Some(mut saved)) => {
            if let Some(monitor) = window.current_monitor()? {
                let area = monitor
                    .work_area()
                    .size
                    .to_logical::<f64>(monitor.scale_factor());
                saved.width = saved.width.min(area.width);
                saved.height = saved.height.min(area.height);
            }
            window.set_size(LogicalSize::new(saved.width, saved.height))?;
            window.center()?;
            if saved.maximized {
                window.maximize()?;
            }
            geometry = saved;
        }
        Ok(None) => {}
        Err(error) => eprintln!("无法恢复窗口尺寸：{error}"),
    }
    app.manage(WindowState {
        path,
        geometry: Mutex::new(geometry),
    });
    Ok(())
}

pub fn on_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    let Some(state) = window.try_state::<WindowState>() else {
        return;
    };
    if matches!(
        event,
        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }
    ) {
        let result = (|| -> tauri::Result<()> {
            if window.is_fullscreen()? || window.is_minimized()? {
                return Ok(());
            }
            let maximized = window.is_maximized()?;
            let size = window
                .inner_size()?
                .to_logical::<f64>(window.scale_factor()?);
            let mut geometry = state
                .geometry
                .lock()
                .expect("window geometry lock poisoned");
            geometry.maximized = maximized;
            if !maximized && size.width > 0.0 && size.height > 0.0 {
                geometry.width = size.width;
                geometry.height = size.height;
            }
            Ok(())
        })();
        if let Err(error) = result {
            eprintln!("无法读取窗口尺寸：{error}");
        }
    }
    if matches!(event, WindowEvent::CloseRequested { .. }) {
        save(window.app_handle());
    }
}

pub fn save(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<WindowState>() else {
        return;
    };
    let geometry = state
        .geometry
        .lock()
        .expect("window geometry lock poisoned");
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let temp = state.path.with_extension("json.tmp");
        std::fs::write(&temp, serde_json::to_vec(&*geometry)?)?;
        std::fs::rename(temp, &state.path)?;
        Ok(())
    })();
    if let Err(error) = result {
        eprintln!("无法保存窗口尺寸：{error}");
    }
}
