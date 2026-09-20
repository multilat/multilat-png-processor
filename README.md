# Multilat PNG Processor

Batch converts open documents or any folder of images to PNG, preserving
the source folder structure. Modelled on Adobe's Image Processor, which
does not offer PNG output.

- **Version:** 1.5
- **Type:** ExtendScript (`.jsx`)
- **Requires:** Photoshop CS6 or newer (see Older Versions below)

## Install

The script itself is cross-platform. Only the installer differs.

### Windows

Right-click `Install-Script.bat` and choose **Run as administrator**.
If you double-click it instead, it asks for elevation itself.

Photoshop's `Presets\Scripts` folder lives under Program Files, which is
protected, so administrator rights are required either way.

### macOS

Double-click `Install-Script.command`. It asks for an administrator
password, because the Presets folder is root-owned.

If macOS blocks it as an unidentified developer, right-click the file and
choose **Open**, then confirm.

### Both Platforms

Afterwards, **quit Photoshop completely and reopen it**. The Scripts menu
is only read at launch.

The script appears under **File > Scripts > Multilat-PNG-Processor**.

### Manual Install

Copy `Multilat-PNG-Processor.jsx` into the Photoshop application's
`Presets/Scripts` folder:

**Windows:**

```text
C:\Program Files\Adobe\Adobe Photoshop 2026\Presets\Scripts\
```

**macOS:**

```text
/Applications/Adobe Photoshop 2026/Presets/Scripts/
```

Do **not** use the user-level folder. On macOS,
`~/Library/Application Support/Adobe/.../Presets/Scripts` is never
scanned for scripts, unlike other preset types.

## Usage

1. **Select Images** — use the open documents, or point it at a folder
   with optional subfolder recursion. Camera Raw formats are opt-in.
2. **Select Location To Save** — beside each source, or into a separate
   folder with the source tree recreated.
3. **File Type** — the three named levels are Photoshop's own PNG
   methods. Custom exposes compression 0 to 9.
4. **Preferences** — overwrite existing PNGs, write a log file.

A progress window reports position. **Hold Esc** to stop after the
current file finishes — it never interrupts a write mid-file.

There is deliberately no Stop button. A ScriptUI palette only receives
clicks while the script yields, and the conversion loop holds the thread
throughout, so a button would be clickable for only a few milliseconds
between files. Esc is polled at the top of every iteration and works
reliably. Hold it rather than tapping it, because the check reads the key
held at that instant.

## Log File

`PNG_Export_Log.txt` is written into the destination folder, recording
settings, per-file save time and output size, and every skip or failure
by name. Useful when a teammate reports odd output.

## Notes

### PNG Method, Not Just Compression

ExtendScript's `PNGSaveOptions` has no `method` property, so
`doc.saveAs()` never tells Photoshop which PNG method to use. Photoshop
then inherits whatever was last chosen in its own PNG Format Options
dialog, and `compression` is only honoured when that method is `quick`.
The practical effect is a save whose speed and file size depend on a
dialog the script never touched.

This script therefore saves through the Action Manager and sets the
method explicitly. The three named choices map to Photoshop's own:

| Dialog Choice                        | PNG Method |
| ------------------------------------ | ---------- |
| Large File Size (Fastest Saving)     | `quick`    |
| Medium File Size (Medium Saving)     | `moderate` |
| Smallest File Size (Slowest Saving)  | `thorough` |

All three are verified working on Photoshop 2026. Measured over the same
12 files:

| Method     | Time per file | Output per file |
| ---------- | ------------- | --------------- |
| `quick`    | 462 ms        | 1158 KB         |
| `moderate` | 664 ms        | 992 KB          |
| `thorough` | 1360 ms       | 936 KB          |

Time rises and size falls across the three, and file-by-file the ordering
holds, so each method is genuinely distinct.

Compression 0 means *stored* — no compression at all. It produces larger
files that are slower to write. Use 1 for speed, not 0.

### Keep Folder Structure

With a chosen source folder, structure is measured from that folder.

With open documents there is no chosen folder, so the deepest folder the
documents share is used instead. Open three files from
`DONE/PSD/01_SKU/…`, `DONE/PSD/02_SKU/…` and `DONE/PSD/13_SKU/…` and the
tree is recreated from `DONE/PSD` down.

Documents never saved to disk have no path and are left out of that
calculation. If the open files share no common folder — spread across
unrelated places, or across two volumes — the script says so and asks
before saving everything flat into the destination.

The log records which folder was used:

```text
Structure Measured From: /Users/you/Downloads/DONE/PSD
```

### Colour Profiles

Photoshop does not embed an ICC profile in a PNG, from a script or by
hand — a manual "Save a Copy" produces no `iCCP` chunk either. Output
carries XMP metadata only.

There is therefore no option for it. The script checks every written file
for an `iCCP` chunk and reports what it finds, so if a future Photoshop
gains the ability the log will say so.

Untagged PNG is read as sRGB everywhere, so sRGB sources come out
correct.

### Saving The Right Document

Photoshop routes `saveAs` through the *active* document, not the one the
method is called on. Saving a non-active document writes the front
document's pixels into the target file. Every save here activates its
document first.

### File Encoding

Keep this file **pure ASCII**. A `.jsx` without a byte-order mark is read
using the system encoding, and a single non-ASCII character — an em dash
in a comment is enough — stops the script parsing with no error message.

### Line Endings

`.bat` files must keep CRLF line endings or Windows may mis-parse them.
`.gitattributes` pins this, so do not override it.

### Older Versions

The PNG method is set through the Action Manager, and the `PNGMethod`
key was only introduced in Photoshop CC 2018. On anything older, that
save fails and the script falls back to `doc.saveAs()`, which cannot set
the method. Conversion still works, but the File Size choice is ignored
and Photoshop uses whatever was last set in its own PNG dialog.

The log says so when this happens:

```text
WARNING: Action Manager Save Failed On At Least One File;
         The Fallback Ignores The PNG Method Setting.
```

## Maintenance

A Photoshop major-version upgrade replaces the application folder and
takes the Presets/Scripts contents with it. Re-run the installer after
upgrading.
