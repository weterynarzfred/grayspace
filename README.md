# grayspace

grayspace is a workspace-oriented file browser for Windows using Tauri (Rust + React JS). It is a file manager, but each folder can act as a configurable workspace with panels, scripts, and local tooling.

## what is there

Usable scaffolding, but missing core file-manager features.

* multi-window, tabs, arbitrary panels
* workspace detection + layout persistence
* filesystem panel (basic ops, thumbnails for images, watcher)
* terminal (Git Bash, multi instances)
* preview (media + text editing via CodeMirror)
* file properties (read-only)
* drag & drop in/out
* command palette + settings panel command list
* command palette + settings panel command list + custom context menu placeholders
* external UI panel from workspace config

## run locally (windows)

This project is currently Windows-first.

Requirements:

* Node.js 20+
* Rust toolchain (`rustup`, `cargo`)
* Git for Windows (terminal panel currently has hardcoded `C:\Program Files\Git\bin\bash.exe`)

Install and run:

```
npm install
npm run tauri_dev
```

## TODO

### global

* [x] multiple panels + layout system
* [x] multiple windows and tabs
* [x] drag in/out of app
* [ ] menu bar
* [x] custom context menu (placeholder routing for file/folder/breadcrumb/tab)
  * [ ] custom commands, global and per workspace
* [x] command palette window (`Ctrl+Shift+P`, UI scaffold)
* [x] settings panel with read-only command list
* [ ] global config system
* [x] remove the native window bar at the top, add draggable region and minimize/maximize/close buttons
* [ ] when closing a tab, first check if any panels don't require a confirmation
* [ ] when closing a window, first check if tabs don't require a confirmation
* [ ] trigger thumbnail cache pruning

### workspaces

* [x] `.grayspace/folder.json`
* [x] layout persistence
* [ ] auto-run commands on open
* [ ] UI for workspace config
* [ ] pane-level config (e.g. styling)
* [ ] folder preview and thumbnail
* [x] add better scrollbars
* [ ] persist scroll position on tab switch
* [ ] refresh the panel when `folder.json` is edited

### QOL

* [ ] new folder / new file shortcuts
* [ ] tab switching shortcuts
* [ ] panel switching shortcuts
* [ ] folder history search (ctrl + r)

### filesystem (ctrl + shift + e)

* [x] navigation + selection
* [x] drag move
* [x] delete
* [x] multi-select
* [x] watcher
* [x] breadcrumbs
* [x] icons
* [x] basic thumbnails
  * [ ] video thumbnails (`ffmpeg-next` + bundled `ffmpeg` ?)
  * [ ] audio thumbnails (cover extraction via `lofty` ?)
  * [ ] pdf thumbnails (`pdfium-render` ?)
  * [ ] epub thumbnails
  * [ ] font thumbnails
  * [ ] maybe try integrating providers through the Windows shell?
* [ ] rename (F2)
  * [ ] bulk rename
* [ ] cut / copy / paste
  * [ ] system integration
* [ ] undo (ctrl+z)
* [ ] keyboard navigation
* [ ] path input / navigation
* [ ] back/forward history
* [ ] search + filtering
* [ ] "open with"
* [ ] drag between tabs
* [ ] history
* [x] thumbnail sizing
* [ ] filters (incl. custom JS)
* [ ] bulk rename (regex)
* [ ] archive (zip, rar, 7z, etc) operations
* [ ] add middle click on breadcrumbs, drives, and ".."
* [ ] figure out what a "main" filesystem panel is, because when there's multiple, they fight
* [ ] deselect file on empty space click
* [x] virtualize file lists in large folders

### terminal (ctrl + shift + `)

* [x] shell integration
* [x] multiple instances
* [ ] shell selection
* [ ] better coupling/decoupling from filesystem

### scripts

* [x] load from config
* [x] run via UI buttons
* [ ] move toward **command palette-based execution** and remove the panel

### preview

* [x] media + text preview/edit
* [x] sync with selection
* [x] lock preview
* [ ] slideshow
* add more preview types
  * [ ] pdf (https://github.com/mozilla/pdf.js ?)
  * [ ] csv/tsv
  * [ ] editable spreadsheets (https://github.com/jspreadsheet/ce ?)
  * [ ] editable svg (https://svg-edit.github.io/svgedit ?)
  * [ ] markdown editor (https://mdxeditor.dev/editor/docs/code-blocks ?)
  * [ ] json, yaml preview
  * [ ] docx
  * [ ] epub
  * [ ] fonts
  * [ ] maybe sqlite or other DB viewer/editor if there's anything nice
  * [ ] maybe try integrating providers through the Windows shell?

### properties (ctrl + shift + v)

* [x] basic info
* [ ] metadata support
* [ ] editable properties
* [ ] custom metadata (sidecar files)
* [ ] bulk properties when multiple files are selected

### external UI

* [x] load URL from `.grayspace/folder.json` (`externalUI`) inside panel
* [ ] load HTML files

### canvas (ctrl + shift + g)

* [ ] define scope
* [ ] drawing interface (https://konvajs.org ?)
* [ ] files as objects
* [ ] file actions on file objects

## might get scrapped

* undo system
* the whole canvas panel
