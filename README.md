# grayspace

grayspace is a workspace-oriented file browser for Windows using Tauri (Rust + React JS). It is a file manager, but each folder can act as a configurable workspace with panels, scripts, and local tooling.

It's a personal project, don't expect it to replace Windows file explorer for you anytime soon.

## what is there

Usable scaffolding, but missing core file-manager features.

* multi-window, tabs, arbitrary panels
* workspace detection + layout persistence
* filesystem panel (basic ops, folder tree / details / grid / foldable grid views, sorting, thumbnails for images, videos and anything Windows can thumbnail, watcher)
* terminal (Git Bash, multi instances)
* preview (media + text editing via CodeMirror, tabbed)
* file properties (read-only)
* drag & drop in/out
* custom context menu with submenus, plus the Windows context menu ("Show More Options" / `Shift+Right-click`)
* external UI panel from workspace config
* popover notifications and confirmation dialogs
* command palette + centralized command registry
* settings panel command list (read-only)

## run locally (windows)

This project is currently Windows-first.

Requirements:

* Node.js 20+
* Rust toolchain (`rustup`, `cargo`)
* Git for Windows (terminal panel currently has hardcoded `C:\Program Files\Git\bin\bash.exe`)
* `ffmpeg.exe` (any recent build, e.g. from gyan.dev) copied to `src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe`; it's bundled for video thumbnails and kept out of git, and the Rust build fails without it

Install and run:

```
npm install
npm run tauri_dev
```

## opening from outside

* `grayspace.exe <folder>` opens the folder; `grayspace.exe <file>` opens its folder with the file selected
* only one instance runs: launching again with a path opens it as a new tab in the last focused window, launching again without one opens a new window

## keyboard shortcuts

### active

* `Ctrl+Shift+P` open command palette
* `Ctrl+T` new tab
* `Ctrl+N` new window (32 px down and right of the current one, same size and maximized state)
* `Ctrl+Tab` switch to next tab
* `Ctrl+F4` or middle-click tab: close tab
* `Alt+V` split active pane vertically
* `Alt+H` split active pane horizontally
* `Ctrl+Shift+E` switch active pane to filesystem
* `Ctrl+Shift+\`` switch active pane to terminal
* `Ctrl+Shift+V` switch active pane to preview
* `Ctrl+Shift+O` switch active pane to properties
* `Ctrl+Shift+U` switch active pane to external UI
* `Ctrl+R` open recently opened folders
* filesystem panel:
  * `Arrow Up/Down` move selection, from the item last clicked or moved to; they loop around once the whole folder is loaded (a long folder loads in pages as you scroll; until then they stop at the first / last loaded item)
  * `Shift+Arrow Up/Down` range selection (stops at the first / last item)
  * `Arrow Right/Left` expand/collapse the folder last clicked or moved to
  * in grid view `Arrow Up/Down` go to the cell in the same column on the row above / below (loops once the whole folder is loaded; a shorter last row takes its last cell), and `Arrow Right/Left` step through the cells in reading order (folders don't open in place; stops at the first / last cell); with `Shift`, Up/Down extend by a row and stop at the first / last row
  * `Enter` open selected item(s)
  * `Ctrl+Enter` open selected folder in new tab
  * `Alt+ArrowLeft` go back in folder history
  * `Alt+ArrowRight` go forward in folder history
  * `Alt+Arrow Up` go one folder up (with workspace-exit confirmation when needed)
  * `Delete` delete selected item(s)
  * `F2` rename selected file/folder
  * `Ctrl+C` / `Ctrl+X` / `Ctrl+V` copy / cut / paste (shares the Windows clipboard)
  * `Ctrl+Shift+T` create text file and rename immediately
  * `Ctrl+Shift+N` create folder and rename immediately
  * `Ctrl+Z` undo filesystem action
  * `Ctrl+Y` redo filesystem action
  * `Ctrl+L` or `Alt+D` focus breadcrumb path input
  * `Ctrl+F` filter current folder by name (`Enter` / `Arrow Down` back to the list, `Esc` clears; cleared when leaving the folder)
  * `Ctrl+Shift+F` search current folder and subfolders by name; results replace the listing and work like normal entries (first 5000 matches, symlinks/junctions not followed); `Ctrl+F` / `Ctrl+Shift+F` inside the box switch between filter and search
    * skip list: folders named `.git`, `.hg`, `.svn`, `node_modules`, `__pycache__`, `.venv`, `$RECYCLE.BIN`, `System Volume Information` are listed as matches but not searched inside (the folder the search starts in always is); the list is editable (comma-separated) and can be switched off in the `▾` options next to the box
    * optional: skip folders containing a `CACHEDIR.TAG` file (e.g. Rust `target/`), off by default
    * `.*` toggles regex: matched case-insensitively against the path relative to the current folder, `/` between folders (e.g. `src/components/.*\.jsx$`)
    * "Reset to defaults" in the options; the options are saved per pane in workspaces (`.grayspace/panels.json`), elsewhere kept for the session
  * `Ctrl+Wheel` change thumbnail size; in both grid views thumbnails fill their cell, so the size is the smallest they get (from 64 px up; in the foldable grid's opened folders about 10% smaller); foldable grid folder rows stay at most 32 px tall
  * `Ctrl+H` show / hide hidden files (also in the command palette and the context menu's "View"); one setting for all panes and windows, kept across restarts; shown (dimmed) by default; when hidden, search skips hidden items and does not look inside hidden folders
  * view type (folder tree / details / grid / foldable grid) from command palette or context menu ("View"); remembered per workspace, or per folder outside workspaces
  * foldable grid: the folder tree with files as tiles; folders are compact rows (expander, indent guides) at every depth, files are tiles that fill the (indented) width of their level; top-level tiles are laid out like grid view's, and an opened folder keeps its parent's columns with tiles up to 10% narrower, dropping one column at a time when that is not enough
    * opening a folder (expander click, or `Arrow Right` on its row) shows its subfolders as rows and its files as tiles right under its row, one level in; opened folders are shared with the folder tree and details views
    * `Arrow Up/Down` go to the tile in the same column on the line above / below (a folder row counts as the first column; loops once the whole folder is loaded)
    * `Arrow Right/Left` open / close the folder row you're on; otherwise they step to the next / previous item in reading order and stop at the first / last one; with `Shift` they only extend the range
    * drops on a tile, or in the empty space between an opened folder's tiles, go into that folder (also drops from Explorer); in the top level's empty space they go into the current folder; clicks and right-clicks in empty space act on the current folder
  * sort by name / date modified / size / type from details column headers, command palette or context menu ("Sort By"); same key again reverses the order; remembered with the view type
  * the palette and context menu mark the current view type and hidden-files setting with `✓`, and the current sort key with its direction (`▴` / `▾`)
  * mouse: middle-click folder, breadcrumb or drive, or `Ctrl+DoubleClick` folder, opens it in a new tab
  * `Shift+Right-click` (or "Show More Options" in the context menu) opens the Windows context menu for the selection or the folder background (7-Zip, Git, "Open with", "Send to", ...); `Shift+Right-click` also lists the extended entries (e.g. "Copy as path"); Open and Rename picked there run grayspace's own versions
* text preview:
  * `Ctrl+Wheel` change font size

### planned (inactive)

* `Ctrl+Space` toggle active pane maximize
* `F2` (multiple selection) bulk rename

## TODO

### global

* [x] multiple panels + layout system
* [x] multiple windows and tabs
* [x] drag in/out of app
* [ ] menu bar
* [x] custom context menu
  * [ ] custom commands, global and per workspace
  * [x] multi-level entries
* [x] command palette window (`Ctrl+Shift+P`)
* [x] settings panel with read-only command list
* [ ] global config system
* [x] remove the native window bar at the top, add draggable region and minimize/maximize/close buttons
* [ ] when closing a tab, first check if any panels don't require a confirmation
* [ ] when closing a window, first check if tabs don't require a confirmation
* [x] trigger thumbnail cache pruning (thumbnails unused for 30 days, or the oldest above 2 GB; checked 30 s after start, then daily)
* [x] remember last window's size and position (the most recently moved, resized or maximized window; new windows open cascaded from the last focused one)
* [x] open a folder / file passed on the command line
* [x] single instance (later launches open a tab or window in the running app)

### workspaces

* [x] `.grayspace/folder.json`
* [x] layout persistence
* [ ] auto-run commands on open
* [ ] UI for workspace config
* [x] per-workspace css
* [ ] folder preview and thumbnail
* [x] add better scrollbars
* [x] persist scroll position on tab switch
* [ ] refresh the panel when `folder.json` is edited
* [x] add custom scripts to command palette

### QOL

* [x] new folder / new file shortcuts
* [x] tab switching shortcuts
* [x] panel switching shortcuts
* [x] folder history search / recent folders popover (`Ctrl+R`)

### filesystem (ctrl + shift + e)

* [x] navigation + selection
* [x] drag move
* [x] delete
* [x] multi-select
* [x] watcher
* [x] breadcrumbs
* [x] icons
* [x] basic thumbnails
  * [x] video thumbnails from the bundled ffmpeg (frame at about 25% of the length, black or blank frames skipped, 15 s limit per video)
  * [x] everything else Windows can thumbnail, same as Explorer (fonts, Office files, ...; PDF / EPUB only with a thumbnailer installed, e.g. PowerToys)
  * own thumbnails where Windows has none:
    * [ ] audio covers (`lofty` ?)
    * [ ] pdf (`pdfium-render` ?)
    * [ ] epub
* [x] rename (F2)
  * [ ] bulk rename
* [x] copy / move / delete run in the background (progress and Cancel in the panel header)
  * [x] name conflicts ask: Replace (old item to the Recycle Bin once the new one is ready next to it; a folder onto a folder merges into it, same-named files inside are replaced the same way, but inside a merge a folder is never replaced by a file or link; a link (symlink / junction) in the destination is replaced, never written through; a linked folder in the source is copied as its contents, like Explorer, and a move on one drive moves the link itself; a folder that holds the item is not replaced, nor merged into where the merge would reach the item) / Keep both / Skip
  * [x] copying into the same folder keeps both
  * [x] merge folders on Replace (a move removes the source folders it empties and can be undone, also after a cancel or error; a cancelled or failed merge keeps what it already moved or copied, and an item it was about to replace stays in place)
  * [ ] operation queue (the panel waits for its running operation)
* [x] cut / copy / paste
  * [x] system integration
* [x] undo (ctrl+z)
* [x] keyboard navigation
* [x] path input / navigation
* [x] back/forward history
* [x] filter current folder (`Ctrl+F`)
* [x] recursive search (`Ctrl+Shift+F`)
  * [x] skip list (`node_modules`, `.git`, ...)
  * [ ] content search
* [x] Windows context menu ("Open with", "Send to", shell extensions)
  * [ ] own "open with" list
* [ ] drag between tabs
* [ ] history
* [x] thumbnail sizing (incl. `Ctrl+Wheel`)
  * [x] previews in both grid views fill their cell; cached at 64 / 256 / 512 px, and sizes from 192 px up use 512 px so the bigger previews stay sharp
* [x] grid / foldable grid views
  * [x] persist view type and thumbnail size per workspace, and per folder outside workspaces
  * [x] column-aware arrow keys in grid view
  * [ ] New / Paste from the menu of an opened folder's empty space in the foldable grid go into that folder (now the current folder, while drops there go into the opened one)
* [x] details view (date modified, type, size columns)
  * [ ] resizable / configurable columns
* [x] sorting (name / date modified / size / type, natural order, folders first)
* [x] hidden files dimmed
  * [x] toggle to hide them (`Ctrl+H`)
* [ ] filters (incl. custom JS)
* [ ] archive (zip, rar, 7z, etc) operations
* [x] add middle click on breadcrumbs and drives
* [x] allow "sub" filesystem panels that don't hijack the workspace context
* [x] deselect file on empty space click
* [x] virtualize file lists in large folders
  * [x] arrow keys scroll to an item outside the rendered part of a long list (all views, also when Up/Down loop around, which needs the whole folder loaded)

### terminal (ctrl + shift + `)

* [x] shell integration
* [x] multiple instances
* [ ] shell selection
* [ ] better coupling/decoupling from filesystem

### preview (ctrl + shift + v)

* [x] media + text preview/edit
* [x] sync with selection
* [x] lock preview
* [x] add a separate tab system
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

### properties (ctrl + shift + o)

* [x] basic info
* [ ] metadata support
* [ ] editable properties
* [ ] custom metadata (sidecar files)
* [ ] bulk properties when multiple files are selected

### external UI (ctrl + shift + u)

* [x] load URL from `.grayspace/folder.json` (`externalUI`) inside panel
* [ ] load HTML files

### canvas (ctrl + shift + g)

* [ ] define scope
* [ ] drawing interface (https://konvajs.org ?)
* [ ] files as objects
* [ ] file actions on file objects

## might get scrapped

* the whole canvas panel
