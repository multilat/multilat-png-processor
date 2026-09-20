# Multilat PNG Processor

Batch converts open documents or any folder of images to PNG, preserving
the source folder structure. Modelled on Adobe's Image Processor, which
does not offer PNG output.

- **Version:** 1.1
- **Type:** ExtendScript (`.jsx`)
- **Requires:** Photoshop 2024 or newer

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
4. **Preferences** — overwrite existing PNGs, embed the colour profile,
   write a log file.

A progress window reports position and carries a **Stop** button. Esc
also stops the run. Either takes effect between files, never mid-write.

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

Compression 0 means *stored* — no compression at all. It produces larger
files that are slower to write. Use 1 for speed, not 0.

### Colour Profiles

Photoshop does not embed an ICC profile in a PNG, from a script or by
hand. Output carries XMP metadata only. The script verifies each written
file for an `iCCP` chunk and reports honestly rather than assuming.

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

## Maintenance

A Photoshop major-version upgrade replaces the application folder and
takes the Presets/Scripts contents with it. Re-run the installer after
upgrading.
