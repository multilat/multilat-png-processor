#target photoshop

/*
 * Multilat PNG Processor
 * Purpose: Batch Convert Open Documents Or Any Folder Of Images To PNG
 *          While Preserving The Source Folder Structure
 *
 * Version: 1.2
 * Author: Multilat
 */

(function () {

    // ================= Helpers =================

    function ensureFolder(folder) {
        if (folder.exists) { return true; }
        ensureFolder(folder.parent);
        return folder.create();
    }

    // macOS Uses Forward Slashes, Windows Backslashes. Building Paths From
    // fsName Means The Separator Has To Match The Platform Or The Result Is A
    // Mixed Path That Reads Wrong And Is Awkward To Debug.
    var IS_WINDOWS = ($.os.toLowerCase().indexOf("windows") !== -1);
    var SEP        = IS_WINDOWS ? "\\" : "/";
    var LINE_END   = IS_WINDOWS ? "Windows" : "Unix";

    // Formats Photoshop Opens Without Showing An Import Dialog
    var STANDARD_FORMATS = /\.(psd|psb|tif|tiff|jpg|jpeg|jpe|png|gif|bmp|dib|tga|targa|webp|heic|heif|jp2|j2k|jpf|exr|hdr|sgi|rle|pbm|pgm|ppm|pcx|ico)$/i;

    // Camera Raw Formats - These Route Through The Camera Raw Engine
    var RAW_FORMATS = /\.(dng|cr2|cr3|nef|nrw|arw|srf|sr2|orf|raf|rw2|pef|raw|erf|mrw|dcr|kdc|x3f|3fr|mef|iiq)$/i;

    function collectFiles(folder, includeSub, includeRaw, out) {
        var items = folder.getFiles();
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (item instanceof Folder) {
                if (includeSub) { collectFiles(item, includeSub, includeRaw, out); }
            } else if (item instanceof File) {
                var name = decodeURI(item.name);
                if (name.charAt(0) === ".") { continue; }
                if (name === "PNG_Export_Log.txt") { continue; }
                if (STANDARD_FORMATS.test(name)) { out.push(item); }
                else if (includeRaw && RAW_FORMATS.test(name)) { out.push(item); }
            }
        }
        return out;
    }

    function baseName(name) {
        return decodeURI(name).replace(/\.[^\.]+$/, "");
    }

    /*
     * Save A PNG Copy Through The Action Manager.
     *
     * Why Not doc.saveAs() With PNGSaveOptions:
     * ExtendScript's PNGSaveOptions Has No "method" Property, So saveAs Never
     * Tells Photoshop Which PNG Method To Use. Photoshop Then Falls Back To
     * Whatever Was Last Chosen In Its Own PNG Format Options Dialog. Worse,
     * compression And interlaced Are Only Honoured When The Method Is "quick",
     * So Those Settings Are Silently Ignored Under The Other Two Methods.
     * The Result Is A Save Whose Speed And File Size Depend On A Dialog The
     * Script Never Touched. Going Through The Action Manager Sends The Method
     * Explicitly And Matches What Photoshop's Own Save Does.
     */
    function saveCopyAsPng(doc, outFile, methodId, compressionLevel, isInterlaced, embedProfile) {
        function s2t(name) { return app.stringIDToTypeID(name); }

        app.activeDocument = doc;

        var format = new ActionDescriptor();
        format.putEnumerated(s2t("method"), s2t("PNGMethod"), s2t(methodId));
        format.putEnumerated(
            s2t("PNGInterlaceType"), s2t("PNGInterlaceType"),
            isInterlaced ? s2t("PNGInterlaceAdam7") : s2t("PNGInterlaceNone"));

        // compression Is Only Read When The Method Is "quick"
        if (methodId === "quick") {
            format.putInteger(s2t("compression"), compressionLevel);
        }

        if (embedProfile) {
            format.putEnumerated(s2t("embedIccProfileLastState"), s2t("embedOff"), s2t("embedOn"));
        }

        var desc = new ActionDescriptor();
        desc.putObject(s2t("as"), s2t("PNGFormat"), format);
        desc.putPath(s2t("in"), outFile);
        desc.putBoolean(s2t("copy"), true);
        desc.putBoolean(s2t("lowerCase"), true);

        executeAction(s2t("save"), desc, DialogModes.NO);
    }

    /*
     * Read Back The Written File And Look For A PNG iCCP Chunk, Which Is Where
     * An Embedded ICC Profile Lives. Photoshop Does Not Reliably Embed One In A
     * PNG, So The Only Trustworthy Report Is The File Itself Rather Than The
     * Setting We Asked For.
     */
    function pngHasIccProfile(file) {
        try {
            file.encoding = "BINARY";
            if (!file.open("r")) { return false; }
            var head = file.read(65536);   // iCCP Always Precedes The Image Data
            file.close();
            return head.indexOf("iCCP") !== -1;
        } catch (readError) {
            try { file.close(); } catch (ignored) {}
            return false;
        }
    }

    function resizeToFit(doc, maxW, maxH) {
        var w = doc.width.as("px");
        var h = doc.height.as("px");
        if (w <= maxW && h <= maxH) { return; }   // Never Upscale
        var scale = Math.min(maxW / w, maxH / h);
        doc.resizeImage(
            UnitValue(Math.round(w * scale), "px"),
            UnitValue(Math.round(h * scale), "px"),
            doc.resolution,
            ResampleMethod.BICUBICSHARPER
        );
    }

    // ================= Dialog =================

    var dlg = new Window("dialog", "Convert To PNG");
    dlg.orientation = "column";
    dlg.alignChildren = ["fill", "top"];
    dlg.spacing = 10;
    dlg.margins = 16;

    // ---- 1. Select Images ----

    var pSource = dlg.add("panel", undefined, "1. Select Images");
    pSource.orientation = "column";
    pSource.alignChildren = ["fill", "top"];
    pSource.margins = 14;
    pSource.spacing = 8;

    var rbOpen = pSource.add("radiobutton", undefined, "Use Open Files");

    var rowFolder = pSource.add("group");
    rowFolder.alignChildren = ["left", "center"];
    var rbFolder = rowFolder.add("radiobutton", undefined, "Use Folder:");
    var txtSource = rowFolder.add("edittext", undefined, "");
    txtSource.characters = 34;
    var btnSource = rowFolder.add("button", undefined, "Browse...");

    var cbSubfolders = pSource.add("checkbox", undefined, "Include All Subfolders");
    cbSubfolders.value = true;
    var cbRaw = pSource.add("checkbox", undefined, "Include Camera Raw Files (DNG, CR2, NEF, ARW And Similar)");
    cbRaw.value = false;
    // ScriptUI Groups Radio Buttons By Their Immediate Parent. These Two Sit In
    // Different Containers, So Exclusivity Is Enforced By Hand Below.
    rbOpen.value = false;
    rbFolder.value = true;

    // ---- 2. Select Location To Save ----

    var pDest = dlg.add("panel", undefined, "2. Select Location To Save");
    pDest.orientation = "column";
    pDest.alignChildren = ["fill", "top"];
    pDest.margins = 14;
    pDest.spacing = 8;

    var rbSame = pDest.add("radiobutton", undefined, "Save In Same Location");
    rbSame.value = true;

    var rowDest = pDest.add("group");
    rowDest.alignChildren = ["left", "center"];
    var rbOther = rowDest.add("radiobutton", undefined, "Select Folder:");
    rbOther.value = false;
    var txtDest = rowDest.add("edittext", undefined, "");
    txtDest.characters = 34;
    var btnDest = rowDest.add("button", undefined, "Browse...");

    var cbKeepTree = pDest.add("checkbox", undefined, "Keep Folder Structure");
    cbKeepTree.value = true;

    // ---- 3. File Type ----

    var pType = dlg.add("panel", undefined, "3. File Type");
    pType.orientation = "column";
    pType.alignChildren = ["fill", "top"];
    pType.margins = 14;
    pType.spacing = 8;

    // The Three Named Levels Mirror Photoshop's Own PNG Format Options Dialog.
    // PNG Is Lossless, So This Only Trades Saving Speed Against File Size.
    // Image Quality Is Identical At Every Setting.
    pType.add("statictext", undefined, "File Size:");

    var rbLarge  = pType.add("radiobutton", undefined, "Large File Size (Fastest Saving)");
    var rbMedium = pType.add("radiobutton", undefined, "Medium File Size (Medium Saving)");
    var rbSmall  = pType.add("radiobutton", undefined, "Smallest File Size (Slowest Saving)");

    var rowCustom = pType.add("group");
    rowCustom.alignChildren = ["left", "center"];
    var rbCustom = rowCustom.add("radiobutton", undefined, "Custom:");
    var ddComp = rowCustom.add("dropdownlist", undefined,
        ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    ddComp.selection = 9;
    rowCustom.add("statictext", undefined, "(0 = Fastest, 9 = Smallest)");

    // Photoshop Defaults To Smallest File Size
    var compRadios = [rbLarge, rbMedium, rbSmall, rbCustom];
    rbLarge.value = false;
    rbMedium.value = false;
    rbSmall.value = true;
    rbCustom.value = false;

    var cbInterlaced = pType.add("checkbox", undefined, "Interlacing");
    cbInterlaced.value = false;

    var rowResize = pType.add("group");
    rowResize.alignChildren = ["left", "center"];
    var cbResize = rowResize.add("checkbox", undefined, "Resize To Fit");
    rowResize.add("statictext", undefined, "W:");
    var txtW = rowResize.add("edittext", undefined, "2000");
    txtW.characters = 6;
    rowResize.add("statictext", undefined, "H:");
    var txtH = rowResize.add("edittext", undefined, "2000");
    txtH.characters = 6;
    rowResize.add("statictext", undefined, "px");

    // ---- 4. Preferences ----

    var pPrefs = dlg.add("panel", undefined, "4. Preferences");
    pPrefs.orientation = "column";
    pPrefs.alignChildren = ["fill", "top"];
    pPrefs.margins = 14;
    pPrefs.spacing = 8;

    var cbOverwrite = pPrefs.add("checkbox", undefined, "Overwrite Existing PNG Files");
    cbOverwrite.value = false;
    var cbProfile = pPrefs.add("checkbox", undefined, "Embed Color Profile");
    cbProfile.value = true;
    var cbLog = pPrefs.add("checkbox", undefined, "Write Log File");
    cbLog.value = true;

    // ---- Buttons ----

    var rowButtons = dlg.add("group");
    rowButtons.alignment = "right";
    var btnCancel = rowButtons.add("button", undefined, "Cancel", { name: "cancel" });
    var btnRun = rowButtons.add("button", undefined, "Run", { name: "ok" });

    // ---- Dialog Behaviour ----

    function syncEnabled() {
        var byFolder = rbFolder.value;
        txtSource.enabled = byFolder;
        btnSource.enabled = byFolder;
        cbSubfolders.enabled = byFolder;
        cbRaw.enabled = byFolder;

        var toOther = rbOther.value;
        txtDest.enabled = toOther;
        btnDest.enabled = toOther;
        cbKeepTree.enabled = toOther && byFolder;

        txtW.enabled = cbResize.value;
        txtH.enabled = cbResize.value;

        ddComp.enabled = rbCustom.value;
    }

    // The Compression Radios Do Not All Share A Parent Either, So Select By Hand
    function selectCompression(chosen) {
        for (var c = 0; c < compRadios.length; c++) {
            compRadios[c].value = (compRadios[c] === chosen);
        }
        syncEnabled();
    }
    rbLarge.onClick  = function () { selectCompression(rbLarge); };
    rbMedium.onClick = function () { selectCompression(rbMedium); };
    rbSmall.onClick  = function () { selectCompression(rbSmall); };
    rbCustom.onClick = function () { selectCompression(rbCustom); };

    // Enforce Exclusivity Manually, Because The Paired Radios Do Not Share A Parent
    rbOpen.onClick = function () {
        rbOpen.value = true;
        rbFolder.value = false;
        syncEnabled();
    };
    rbFolder.onClick = function () {
        rbFolder.value = true;
        rbOpen.value = false;
        syncEnabled();
    };
    rbSame.onClick = function () {
        rbSame.value = true;
        rbOther.value = false;
        syncEnabled();
    };
    rbOther.onClick = function () {
        rbOther.value = true;
        rbSame.value = false;
        syncEnabled();
    };
    cbResize.onClick = syncEnabled;

    btnSource.onClick = function () {
        var f = Folder.selectDialog("Select The Source Folder");
        if (f !== null) { txtSource.text = f.fsName; }
    };
    btnDest.onClick = function () {
        var f = Folder.selectDialog("Select The Destination Folder");
        if (f !== null) { txtDest.text = f.fsName; }
    };

    syncEnabled();

    if (dlg.show() !== 1) { return; }

    // ================= Read Settings =================

    var useOpenFiles = rbOpen.value;
    var includeSub   = cbSubfolders.value;
    var includeRaw   = cbRaw.value;
    var saveSame     = rbSame.value;
    var keepTree     = cbKeepTree.value && cbKeepTree.enabled;
    // The Three Named Choices Are Photoshop's Own PNG Methods. Compression Is
    // A Sub-Setting Of The Fast Method Only, Which Is Why Custom Uses "quick".
    var pngMethod   = "thorough";
    var compression = 6;
    if (rbLarge.value)       { pngMethod = "quick";    compression = 1; }
    else if (rbMedium.value) { pngMethod = "moderate"; }
    else if (rbSmall.value)  { pngMethod = "thorough"; }
    else if (rbCustom.value) { pngMethod = "quick";    compression = ddComp.selection.index; }
    var interlaced   = cbInterlaced.value;
    var embedProfile = cbProfile.value;
    var doResize     = cbResize.value;
    var maxW         = parseInt(txtW.text, 10);
    var maxH         = parseInt(txtH.text, 10);
    var overwrite    = cbOverwrite.value;
    var writeLog     = cbLog.value;

    if (doResize && (isNaN(maxW) || isNaN(maxH) || maxW < 1 || maxH < 1)) {
        alert("Resize Width And Height Must Be Whole Numbers Above Zero.");
        return;
    }

    var sourceFolder = null;
    if (!useOpenFiles) {
        if (txtSource.text === "") { alert("No Source Folder Was Selected."); return; }
        sourceFolder = new Folder(txtSource.text);
        if (!sourceFolder.exists) { alert("Source Folder Does Not Exist:\n" + txtSource.text); return; }
    }

    var destFolder = null;
    if (!saveSame) {
        if (txtDest.text === "") { alert("No Destination Folder Was Selected."); return; }
        destFolder = new Folder(txtDest.text);
        if (!ensureFolder(destFolder)) { alert("Destination Folder Could Not Be Created:\n" + txtDest.text); return; }
    }

    // ================= Build The Work List =================

    var jobs = [];   // { doc | file, folder }

    if (useOpenFiles) {
        if (app.documents.length === 0) { alert("There Are No Open Documents."); return; }
        for (var d = 0; d < app.documents.length; d++) { jobs.push({ doc: app.documents[d], file: null }); }
    } else {
        var found = collectFiles(sourceFolder, includeSub, includeRaw, []);
        if (found.length === 0) {
            alert("No Supported Image Files Were Found In:\n" + sourceFolder.fsName);
            return;
        }
        for (var s = 0; s < found.length; s++) { jobs.push({ doc: null, file: found[s] }); }
    }

    if (!confirm("Found " + jobs.length + " File(s).\n\nConvert Them To PNG Now?")) { return; }

    // ================= Convert =================

    // Kept Only As A Fallback If The Action Manager Save Is Unavailable
    var opts = new PNGSaveOptions();
    opts.compression = compression;
    opts.interlaced  = interlaced;
    var usedFallback = false;

    var savedDialogs = app.displayDialogs;
    var savedUnits   = app.preferences.rulerUnits;
    app.displayDialogs = DialogModes.NO;
    app.preferences.rulerUnits = Units.PIXELS;

    var converted = 0;
    var skipped   = [];
    var failed    = [];
    var cancelled = false;

    // Timing Instrumentation, So Settings Can Be Compared With Real Numbers
    // Rather Than Impressions. Written Into The Log File.
    var timings    = [];
    var totalMs    = 0;
    var totalBytes = 0;
    var profilesEmbedded = 0;

    // Esc Is The Habitual Way To Stop A Script, So Honour It As Well As The
    // Stop Button. keyboardState Is Not Available Everywhere, Hence The Guard.
    function userPressedEscape() {
        try {
            return ScriptUI.environment.keyboardState.keyName === "Escape";
        } catch (noKeyboardState) {
            return false;
        }
    }

    // The Progress Palette Is Optional. A Palette Needs A Persistent Engine,
    // Which Is Not Guaranteed, So Never Let Its Absence Stop The Conversion.
    var progress = null;
    var progressText = null;
    var progressBar = null;
    try {
        progress = new Window("palette", "Converting To PNG");
        progress.orientation = "column";
        progress.alignChildren = ["fill", "top"];
        progress.margins = 16;
        progressText = progress.add("statictext", undefined, "Starting...");
        progressText.characters = 46;
        progressBar = progress.add("progressbar", undefined, 0, 0, jobs.length);
        // Set The Range Explicitly Too. The Positional Form Has Bitten Us Once
        // Already And Differs In Behaviour Across Photoshop Versions.
        progressBar.minvalue = 0;
        progressBar.maxvalue = jobs.length;
        progressBar.value    = 0;
        progressBar.preferredSize.width = 340;

        var rowStop = progress.add("group");
        rowStop.alignment = "right";
        var btnStop = rowStop.add("button", undefined, "Stop");
        btnStop.onClick = function () {
            cancelled = true;
            pumpProgress("Stopping After The Current File...", null);
        };

        progress.center();
        progressText.text = "Starting " + jobs.length + " File(s)...";
        progress.show();

        // A Palette Is Only Painted When The Script Yields, And The Conversion
        // Loop Below Never Yields On Its Own. Force Paint Cycles Here So The
        // Window Is On Screen Before The First File Is Opened, Rather Than
        // Surfacing Part Way Through The Run.
        progress.update();
        app.refresh();
        progress.update();
    } catch (uiError) {
        progress = null;
    }

    /*
     * Repaint The Progress Window.
     *
     * A ScriptUI Palette Is Only Redrawn When The Script Yields, And This
     * Conversion Loop Holds The Thread From Start To Finish. On macOS
     * Window.update() Is Usually Enough; On Windows It Frequently Is Not, And
     * The Window Stays Frozen On Whatever It Displayed When First Shown.
     *
     * So Every Surface That Might Repaint Gets Nudged: The Window Title, Which
     * The OS Draws Rather Than ScriptUI, A Forced Re-Layout, And Finally
     * update(). Whichever One Works On A Given Machine, The Operator Sees
     * Movement.
     */
    function pumpProgress(text, value) {
        if (progress === null) { return; }
        try {
            if (value !== null) { progressBar.value = value; }
            if (text !== null) {
                progressText.text = text;
                progress.text = text;        // Title Bar Is Drawn By The OS
            }
            // Older Photoshop Builds May Not Support This, And A Failure Here
            // Must Not Prevent The update() Call Below From Running.
            try { progress.layout.layout(true); } catch (noLayout) {}
            progress.update();
        } catch (paintError) {
            // A Progress Window That Cannot Repaint Must Never Stop The Run
        }
    }

    for (var j = 0; j < jobs.length; j++) {

        var job = jobs[j];
        var openedHere = false;
        var doc = null;
        var work = null;
        var label = "";

        // Pump The Palette So The Stop Button Can Be Clicked Mid-Run
        pumpProgress(null, j);
        if (userPressedEscape()) { cancelled = true; }
        if (cancelled) { break; }

        try {
            // --- Resolve The Document ---
            if (job.doc !== null) {
                doc = job.doc;
                label = baseName(doc.name);
            } else {
                label = baseName(job.file.name);
            }

            pumpProgress((j + 1) + " Of " + jobs.length + ":  " + label, j);

            // --- Work Out Where The PNG Goes ---
            var srcFolderFs;
            if (job.doc !== null) {
                try {
                    srcFolderFs = doc.path.fsName;
                } catch (noPath) {
                    // An Unsaved Document Has No Folder To Save Beside
                    if (saveSame) {
                        failed.push(label + " - Never Saved, So It Has No Location To Save Into");
                        continue;
                    }
                    srcFolderFs = "";
                }
            } else {
                srcFolderFs = job.file.parent.fsName;
            }

            var outFolder;
            if (saveSame) {
                outFolder = new Folder(srcFolderFs);
            } else if (keepTree && sourceFolder !== null) {
                var rel = srcFolderFs.substring(sourceFolder.fsName.length);
                outFolder = new Folder(destFolder.fsName + rel);
            } else {
                outFolder = destFolder;
            }

            if (!ensureFolder(outFolder)) {
                failed.push(label + " - Output Folder Could Not Be Created");
                continue;
            }

            var png = new File(outFolder.fsName + SEP + label + ".png");

            // Never Let A Source PNG Be Written Over Itself
            var sourceFs = "";
            if (job.doc !== null) {
                try { sourceFs = doc.fullName.fsName; } catch (noFile) { sourceFs = ""; }
            } else {
                sourceFs = job.file.fsName;
            }
            if (sourceFs === png.fsName) {
                skipped.push(label + ".png - Source Is Already PNG In This Location");
                continue;
            }

            if (png.exists && !overwrite) {
                skipped.push(label + ".png - Already Exists");
                continue;
            }

            // --- Open If Needed ---
            if (doc === null) {
                doc = app.open(job.file);
                openedHere = true;
            }

            // Photoshop Routes saveAs And Several Other Operations Through The
            // Active Document, Not The One The Method Is Called On. Without This
            // Every Pass Saves Whichever File Happens To Be Frontmost, Which Looks
            // Like The Same Document Being Processed Over And Over.
            app.activeDocument = doc;

            // --- Formats PNG Cannot Hold ---
            if (doc.mode === DocumentMode.CMYK || doc.mode === DocumentMode.LAB) {
                failed.push(label + " - Color Mode Is Not RGB, Left Unconverted");
                if (openedHere) { doc.close(SaveOptions.DONOTSAVECHANGES); }
                doc = null;
                continue;
            }
            if (doc.bitsPerChannel === BitsPerChannelType.THIRTYTWO) {
                failed.push(label + " - 32 Bit Per Channel Is Not Supported By PNG");
                if (openedHere) { doc.close(SaveOptions.DONOTSAVECHANGES); }
                doc = null;
                continue;
            }

            // --- Resize On A Duplicate So The Original Is Never Altered ---
            if (doResize) {
                work = doc.duplicate();
                app.activeDocument = work;   // duplicate() Changes The Active Document
                resizeToFit(work, maxW, maxH);
            } else {
                work = doc;
            }

            // asCopy = true Leaves The Source Document Untouched
            var startedAt = new Date().getTime();
            try {
                saveCopyAsPng(work, png, pngMethod, compression, interlaced, embedProfile);
            } catch (amError) {
                // Fall Back To The DOM Save So A Run Never Dies On This Alone
                usedFallback = true;
                work.saveAs(png, opts, true, Extension.LOWERCASE);
            }
            var elapsedMs = new Date().getTime() - startedAt;

            var writtenBytes = 0;
            try { writtenBytes = png.length; } catch (noSize) { writtenBytes = 0; }

            if (embedProfile && pngHasIccProfile(png)) { profilesEmbedded++; }
            totalMs += elapsedMs;
            totalBytes += writtenBytes;
            timings.push(label + " | " + elapsedMs + " ms | " + Math.round(writtenBytes / 1024) + " KB");

            converted++;

            if (work !== doc) { work.close(SaveOptions.DONOTSAVECHANGES); }
            work = null;
            if (openedHere) { doc.close(SaveOptions.DONOTSAVECHANGES); }
            doc = null;

        } catch (e) {
            failed.push(label + " - " + e.message);
            try {
                if (work !== null && work !== doc) { work.close(SaveOptions.DONOTSAVECHANGES); }
                if (openedHere && doc !== null) { doc.close(SaveOptions.DONOTSAVECHANGES); }
            } catch (ignored) {}
        }
    }

    if (progress !== null) {
        pumpProgress("Finishing...", jobs.length);
        progress.close();
    }

    app.displayDialogs = savedDialogs;
    app.preferences.rulerUnits = savedUnits;

    // ================= Report =================

    var lines = [];
    lines.push("PNG Export Log");
    lines.push("Source: " + (useOpenFiles ? "Open Files" : sourceFolder.fsName));
    lines.push("Destination: " + (saveSame ? "Same Location As Source" : destFolder.fsName));
    lines.push("PNG Method: " + pngMethod +
               (pngMethod === "quick" ? " (Compression " + compression + ")" : "") +
               (interlaced ? " + Interlaced" : ""));
    if (!embedProfile) {
        lines.push("Color Profile: Not Requested");
    } else if (profilesEmbedded === converted && converted > 0) {
        lines.push("Color Profile: Embedded And Verified In All " + converted + " File(s)");
    } else if (profilesEmbedded > 0) {
        lines.push("Color Profile: Embedded In Only " + profilesEmbedded + " Of " + converted + " File(s)");
    } else {
        lines.push("Color Profile: REQUESTED BUT NOT EMBEDDED - Photoshop Wrote No iCCP Chunk.");
        lines.push("               Output Is Untagged And Will Be Read As sRGB.");
    }
    if (usedFallback) {
        lines.push("WARNING: Action Manager Save Failed On At Least One File;");
        lines.push("         The Fallback Ignores The PNG Method Setting.");
    }
    if (converted > 0) {
        lines.push("Total Save Time: " + (totalMs / 1000).toFixed(1) + " s" +
                   "  (Average " + Math.round(totalMs / converted) + " ms Per File)");
        lines.push("Total Output: " + (totalBytes / 1048576).toFixed(1) + " MB" +
                   "  (Average " + Math.round(totalBytes / converted / 1024) + " KB Per File)");
    }
    if (doResize) { lines.push("Resized To Fit: " + maxW + " x " + maxH + " px"); }
    lines.push("Files Found: " + jobs.length);
    if (cancelled) {
        lines.push("RUN STOPPED BY USER - " + (jobs.length - converted - skipped.length - failed.length) + " File(s) Never Processed");
    }
    lines.push("Converted: " + converted);
    lines.push("Skipped: " + skipped.length);
    lines.push("Failed: " + failed.length);

    var n;
    if (skipped.length > 0) {
        lines.push("");
        lines.push("--- Skipped ---");
        for (n = 0; n < skipped.length; n++) { lines.push(skipped[n]); }
    }
    if (failed.length > 0) {
        lines.push("");
        lines.push("--- Failed ---");
        for (n = 0; n < failed.length; n++) { lines.push(failed[n]); }
    }
    if (timings.length > 0) {
        lines.push("");
        lines.push("--- Per File (Save Time | Output Size) ---");
        for (n = 0; n < timings.length; n++) { lines.push(timings[n]); }
    }

    if (writeLog) {
        try {
            var logFolder = saveSame ? (useOpenFiles ? Folder.desktop : sourceFolder) : destFolder;
            var log = new File(logFolder.fsName + SEP + "PNG_Export_Log.txt");
            log.encoding = "UTF-8";
            // ExtendScript Rewrites Line Endings To The Platform Default, Which
            // On macOS Collapses "\r\n" To A Bare CR And Leaves The Log As One
            // Unreadable Line. Pin It To Unix Line Endings Instead.
            log.lineFeed = LINE_END;
            log.open("w");
            log.write(lines.join("\n"));
            log.close();
        } catch (logError) {
            // A Failed Log Must Never Hide The Result Summary
        }
    }

    alert((cancelled ? "STOPPED BY USER\n\n" : "") +
          "Converted " + converted + " Of " + jobs.length + " File(s)" +
          "\nSkipped: " + skipped.length +
          "\nFailed: " + failed.length +
          (writeLog ? "\n\nDetails In PNG_Export_Log.txt" : ""));

}());
