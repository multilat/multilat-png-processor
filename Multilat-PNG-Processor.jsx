#target photoshop

/*
 * Multilat PNG Processor
 * Purpose: Batch Convert Open Documents or Any Folder of Images To PNG
 *          While Preserving The Source Folder Structure
 *
 * Version: 1.5
 * Author: Multilat
 */

(function () {

    // ================= Helpers =================

    function ensureFolder(folder) {
        if (folder === null) { return false; }
        if (folder.exists) { return true; }
        var parent = folder.parent;
        // A Volume Root Reports Itself or null As Its Parent. Without This The
        // Recursion Never Terminates, and An Unreachable Path Such As A
        // Disconnected Mapped Drive Crashes Photoshop on Stack Overflow.
        if (parent === null || parent.fsName === folder.fsName) { return false; }
        if (!ensureFolder(parent)) { return false; }
        return folder.create();
    }

    // String.trim Is ES5 and Absent From Older ExtendScript
    function trimStr(text) {
        return String(text).replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, "");
    }

    // Paths Are Compared Case-Insensitively Because Windows Is Always
    // Case-Insensitive and macOS Volumes Are By Default. Treating Them As
    // Case-Sensitive Risks Writing Over A Source File.
    function samePath(a, b) {
        return String(a).toLowerCase() === String(b).toLowerCase();
    }

    function stripTrailingSep(path) {
        return String(path).replace(/[\\\/]+$/, "");
    }

    /*
     * Deepest Folder That Every Given Path Shares.
     *
     * Open Documents Have No Single Chosen Source Folder, So When Their Tree
     * Has To Be Recreated Somewhere Else The Root Is Derived From The Documents
     * Themselves. Files Spread Across Unrelated Places, or Across Two Volumes,
     * Share Nothing, and The Empty String Returned Here Means "Save Flat".
     */
    function commonAncestor(paths) {
        if (paths.length === 0) { return ""; }
        var parts = String(paths[0]).split(SEP);
        for (var i = 1; i < paths.length; i++) {
            var other = String(paths[i]).split(SEP);
            var limit = Math.min(parts.length, other.length);
            var k = 0;
            while (k < limit && samePath(parts[k], other[k])) { k++; }
            parts = parts.slice(0, k);
            if (parts.length === 0) { return ""; }
        }
        var root = parts.join(SEP);
        // A Single Remaining Segment on macOS Is The Volume Root Itself
        return (root === "") ? "" : root;
    }

    // macOS Uses Forward Slashes, Windows Backslashes. Building Paths From
    // fsName Means The Separator Has To Match The Platform or The Result Is A
    // Mixed Path That Reads Wrong and Is Awkward To Debug.
    var IS_WINDOWS = ($.os.toLowerCase().indexOf("windows") !== -1);
    var SEP        = IS_WINDOWS ? "\\" : "/";
    var LINE_END   = IS_WINDOWS ? "Windows" : "Unix";

    // Formats Photoshop Opens Without Showing An Import Dialog
    var STANDARD_FORMATS = /\.(psd|psb|tif|tiff|jpg|jpeg|jpe|png|gif|bmp|dib|tga|targa|webp|heic|heif|jp2|j2k|jpf|exr|hdr|sgi|rle|pbm|pgm|ppm|pcx|ico)$/i;

    // Camera Raw Formats - These Route Through The Camera Raw Engine
    var RAW_FORMATS = /\.(dng|cr2|cr3|nef|nrw|arw|srf|sr2|orf|raf|rw2|pef|raw|erf|mrw|dcr|kdc|x3f|3fr|mef|iiq)$/i;

    function collectFiles(folder, includeSub, includeRaw, out) {
        // getFiles() Returns null For A Folder This Process Cannot Read, Such
        // As One Blocked By macOS Privacy Controls or A Dropped Network Mount.
        var items = folder.getFiles();
        if (!items) { return out; }
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            // An Alias Pointing At An Ancestor Would Recurse Without End
            if (item.alias) { continue; }
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
     * compression and interlaced Are Only Honoured When The Method Is "quick",
     * So Those Settings Are Silently Ignored Under The Other Two Methods.
     * The Result Is A Save Whose Speed and File Size Depend on A Dialog The
     * Script Never Touched. Going Through The Action Manager Sends The Method
     * Explicitly and Matches What Photoshop's Own Save Does.
     */
    function saveCopyAsPng(doc, outFile, methodId, compressionLevel, isInterlaced) {
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

        var desc = new ActionDescriptor();
        desc.putObject(s2t("as"), s2t("PNGFormat"), format);
        desc.putPath(s2t("in"), outFile);
        desc.putBoolean(s2t("copy"), true);
        desc.putBoolean(s2t("lowerCase"), true);

        executeAction(s2t("save"), desc, DialogModes.NO);
    }

    /*
     * Read Back The Written File and Look For A PNG iCCP Chunk, Which Is Where
     * An Embedded ICC Profile Lives. Photoshop Does Not Reliably Embed One In A
     * PNG, So The Only Trustworthy Report Is The File Itself Rather Than The
     * Setting We Asked For.
     */
    function pngHasIccProfile(file) {
        // A Separate File Object, So The Caller's Is Never Left In BINARY Mode
        var probe = new File(file.fsName);
        try {
            probe.encoding = "BINARY";
            if (!probe.open("r")) { return false; }
            var head = probe.read(65536);
            probe.close();

            // iCCP Always Precedes The Image Data, So Stop At The First IDAT.
            // Searching The Whole Buffer Would Let Compressed Pixel Data
            // Coincidentally Spell iCCP and Report A Profile That Is Not There.
            var end = head.indexOf("IDAT");
            if (end === -1) { end = head.length; }
            return head.substring(0, end).indexOf("iCCP") !== -1;
        } catch (readError) {
            try { probe.close(); } catch (ignored) {}
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
    var cbRaw = pSource.add("checkbox", undefined, "Include Camera Raw Files (DNG, CR2, NEF, ARW and Similar)");
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
        cbKeepTree.enabled = toOther;

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
    // onChange Is Wired Too, Because Arrowing Through A Native Radio Group
    // Does Not Fire onClick on Every ScriptUI Build, Which Would Leave Two
    // Of These Selected At Once.
    rbLarge.onClick  = rbLarge.onChange  = function () { selectCompression(rbLarge); };
    rbMedium.onClick = rbMedium.onChange = function () { selectCompression(rbMedium); };
    rbSmall.onClick  = rbSmall.onChange  = function () { selectCompression(rbSmall); };
    rbCustom.onClick = rbCustom.onChange = function () { selectCompression(rbCustom); };

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
    // A Sub-Setting of The Fast Method Only, Which Is Why Custom Uses "quick".
    var pngMethod   = "thorough";
    var compression = 6;
    if (rbLarge.value)       { pngMethod = "quick";    compression = 1; }
    else if (rbMedium.value) { pngMethod = "moderate"; }
    else if (rbSmall.value)  { pngMethod = "thorough"; }
    else if (rbCustom.value) {
        pngMethod = "quick";
        compression = (ddComp.selection !== null) ? ddComp.selection.index : 6;
    }
    var interlaced   = cbInterlaced.value;
    var doResize     = cbResize.value;
    var maxW         = parseInt(txtW.text, 10);
    var maxH         = parseInt(txtH.text, 10);
    var overwrite    = cbOverwrite.value;
    var writeLog     = cbLog.value;

    if (doResize && (isNaN(maxW) || isNaN(maxH) || maxW < 1 || maxH < 1)) {
        alert("Resize Width and Height Must Be Whole Numbers Above Zero.");
        return;
    }

    var sourceFolder = null;
    if (!useOpenFiles) {
        // Paths Pasted From Finder or Explorer Often Carry Trailing Whitespace
        var sourcePath = trimStr(txtSource.text);
        if (sourcePath === "") { alert("No Source Folder Was Selected."); return; }
        sourceFolder = new Folder(sourcePath);
        if (!sourceFolder.exists) { alert("Source Folder Does Not Exist:\n" + sourcePath); return; }
    }

    var destFolder = null;
    if (!saveSame) {
        var destPath = trimStr(txtDest.text);
        if (destPath === "") { alert("No Destination Folder Was Selected."); return; }
        destFolder = new Folder(destPath);
        if (!ensureFolder(destFolder)) {
            alert("Destination Folder Could Not Be Created:\n" + destPath +
                  "\n\nCheck That The Drive Is Connected And Writable.");
            return;
        }
    }

    // A Destination Inside The Source Survives One Run, Because The File List Is
    // Built Up Front. On The Next Run The Previous Output Is Collected As Input
    // And The Tree Nests One Level Deeper Each Time.
    if (sourceFolder !== null && destFolder !== null) {
        var srcRoot  = stripTrailingSep(sourceFolder.fsName);
        var destRoot = stripTrailingSep(destFolder.fsName);
        if (samePath(destRoot.substring(0, srcRoot.length), srcRoot)) {
            alert("The Destination Folder Is Inside The Source Folder.\n\n" +
                  "Choose A Destination Outside It, or The Next Run Will " +
                  "Convert This Run's Output Again.");
            return;
        }
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

    /*
     * The Folder That Recreated Structure Is Measured From.
     *
     * With A Chosen Source Folder That Is Simply The Folder. With Open Files
     * There Is No Such Choice, So The Deepest Folder The Documents Share Is
     * Used Instead. Documents That Have Never Been Saved Have No Path and Are
     * Left Out of That Calculation.
     */
    var treeRoot = "";
    if (!useOpenFiles) {
        treeRoot = stripTrailingSep(sourceFolder.fsName);
    } else if (keepTree && !saveSame) {
        var docPaths = [];
        for (var t = 0; t < jobs.length; t++) {
            try { docPaths.push(jobs[t].doc.path.fsName); } catch (unsavedDoc) {}
        }
        treeRoot = stripTrailingSep(commonAncestor(docPaths));
    }

    // Warn Before Writing Anything, Because Flat Output Is Not What Was Asked For
    if (useOpenFiles && keepTree && !saveSame && treeRoot === "") {
        if (!confirm("The Open Files Share No Common Folder, So Their Structure " +
                     "Cannot Be Recreated.\n\nSave Them All Into The Destination " +
                     "Folder Instead?")) {
            return;
        }
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

    // Everything From Here To The finally Runs With Photoshop's Preferences
    // Changed. Without finally, A Throw Anywhere In Between Would Leave Dialogs
    // Suppressed and Rulers Pinned To Pixels For The Rest of The Session, With
    // Nothing To Tell The User Why.
    try {

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

    // Claimed Output Paths, So Two Sources Cannot Quietly Map To One File
    var usedNames = {};

    // Esc Is The Only Way To Stop A Run Once It Begins, For The Reason Given
    // Beside The Progress Window Below. keyboardState Reports The Key Held At
    // This Instant, So Esc Has To Be Held Rather Than Tapped. It Is Not
    // Available Everywhere, Hence The Guard.
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
        // Already and Differs In Behaviour Across Photoshop Versions.
        progressBar.minvalue = 0;
        progressBar.maxvalue = jobs.length;
        progressBar.value    = 0;
        progressBar.preferredSize.width = 340;

        // There Is Deliberately No Stop Button. A ScriptUI Palette Only
        // Dispatches Clicks While The Script Yields, and This Loop Holds The
        // Thread From Start To Finish, So A Button Would Be Clickable Only For
        // The Few Milliseconds Between Files. Esc Is Polled At The Top of Every
        // Iteration Instead, Which Works Reliably.
        progress.center();
        progressText.text = "Starting " + jobs.length + " File(s)...";
        progress.add("statictext", undefined, "Hold Esc To Stop After The Current File");
        progress.show();

        // A Palette Is Only Painted When The Script Yields, and The Conversion
        // Loop Below Never Yields on Its Own. Force Paint Cycles Here So The
        // Window Is on Screen Before The First File Is Opened, Rather Than
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
     * A ScriptUI Palette Is Only Redrawn When The Script Yields, and This
     * Conversion Loop Holds The Thread From Start To Finish. On macOS
     * Window.update() Is Usually Enough; on Windows It Frequently Is Not, and
     * The Window Stays Frozen on Whatever It Displayed When First Shown.
     *
     * So Every Surface That Might Repaint Gets Nudged: The Window Title, Which
     * The OS Draws Rather Than ScriptUI, A Forced Re-Layout, and Finally
     * update(). Whichever One Works on A Given Machine, The Operator Sees
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
            // Older Photoshop Builds May Not Support This, and A Failure Here
            // Must Not Prevent The update() Call Below From Running.
            try { progress.layout.layout(true); } catch (noLayout) {}
            progress.update();
            // update() Repaints But Does Not Pump The Message Queue, So Without
            // This The Stop Button Can Never Receive A Click Mid-Run.
            app.refresh();
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
                // Document.name Is A Plain Display String, Unlike File.name,
                // So It Must Not Be Passed Through decodeURI
                label = String(doc.name).replace(/\.[^\.]+$/, "");
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
            } else if (keepTree && treeRoot !== "") {
                // Slice Only When The Prefix Genuinely Matches. A Trailing
                // Separator, An Alias, or A Windows Short Name Would Otherwise
                // Produce A Relative Path That Lands Somewhere Unrelated.
                var base = treeRoot;
                var rel  = samePath(srcFolderFs.substring(0, base.length), base)
                    ? srcFolderFs.substring(base.length)
                    : "";
                if (rel !== "" && rel.charAt(0) !== SEP) { rel = SEP + rel; }
                outFolder = new Folder(stripTrailingSep(destFolder.fsName) + rel);
            } else {
                outFolder = destFolder;
            }

            if (!ensureFolder(outFolder)) {
                failed.push(label + " - Output Folder Could Not Be Created");
                continue;
            }

            // The File Constructor Decodes %xx, and label Has Already Been
            // Decoded Once. Without Re-Escaping, "100%20off" Would Be Written
            // To Disk As "100 off".
            var outBase = stripTrailingSep(outFolder.fsName);
            var png = new File(outBase + SEP + label.replace(/%/g, "%25") + ".png");

            // Never Let A Source PNG Be Written Over Itself
            var sourceFs = "";
            if (job.doc !== null) {
                try { sourceFs = doc.fullName.fsName; } catch (noFile) { sourceFs = ""; }
            } else {
                sourceFs = job.file.fsName;
            }
            if (samePath(sourceFs, png.fsName)) {
                skipped.push(label + ".png - Source Is Already PNG In This Location");
                continue;
            }

            // Two Different Sources Can Produce The Same Output Name, Either
            // From Different Subfolders Flattened Into One Destination or From
            // The Same Folder With Different Extensions. Silently Overwriting
            // One With The Other Would Lose A File.
            var claimKey = String(png.fsName).toLowerCase();
            if (usedNames[claimKey] !== undefined) {
                failed.push(label + ".png - Output Name Already Used By " + usedNames[claimKey]);
                continue;
            }
            usedNames[claimKey] = label;

            if (png.exists && !overwrite) {
                skipped.push(label + ".png - Already Exists");
                continue;
            }

            // --- Open If Needed ---
            if (doc === null) {
                // Without Explicit Options, A Raw File Opens The Camera Raw
                // Dialog and The Batch Stops Dead Waiting For A Click.
                if (RAW_FORMATS.test(decodeURI(job.file.name))) {
                    try {
                        doc = app.open(job.file, new CameraRAWOpenOptions());
                    } catch (rawError) {
                        doc = app.open(job.file);
                    }
                } else {
                    doc = app.open(job.file);
                }
                openedHere = true;
            }

            // Photoshop Routes saveAs and Several Other Operations Through The
            // Active Document, Not The One The Method Is Called on. Without This
            // Every Pass Saves Whichever File Happens To Be Frontmost, Which Looks
            // Like The Same Document Being Processed Over and Over.
            app.activeDocument = doc;

            // --- Formats PNG Cannot Hold ---
            if (doc.mode === DocumentMode.CMYK || doc.mode === DocumentMode.LAB ||
                doc.mode === DocumentMode.DUOTONE || doc.mode === DocumentMode.MULTICHANNEL) {
                failed.push(label + " - Color Mode Cannot Be Written As PNG, Left Unconverted");
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

            // --- Resize on A Duplicate So The Original Is Never Altered ---
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
                saveCopyAsPng(work, png, pngMethod, compression, interlaced);
            } catch (amError) {
                // Fall Back To The DOM Save So A Run Never Dies on This Alone.
                // The Flag Is Set Only After The Fallback Succeeds, Otherwise A
                // Genuine Failure Would Report That Files Were Written With The
                // Wrong Settings When Nothing Was Written At All.
                work.saveAs(png, opts, true, Extension.LOWERCASE);
                usedFallback = true;
            }
            var elapsedMs = new Date().getTime() - startedAt;

            var writtenBytes = 0;
            try { writtenBytes = png.length; } catch (noSize) { writtenBytes = 0; }

            if (pngHasIccProfile(png)) { profilesEmbedded++; }
            totalMs += elapsedMs;
            totalBytes += writtenBytes;
            timings.push(label + " | " + elapsedMs + " ms | " + Math.round(writtenBytes / 1024) + " KB");

            converted++;

        } catch (e) {
            failed.push(label + " - " + e.message);
        }

        // Cleanup Sits Outside The try Above For Two Reasons. A Throwing
        // close() Must Not Add A File That Already Converted To The Failed List
        // As Well, Which Would Make The Tallies Disagree. And Each close() Needs
        // Its Own Guard, or A Failure Closing The Resize Duplicate Would Strand
        // The Document This Script Opened, Leaking One Per File Across A Batch.
        try {
            if (work !== null && work !== doc) { work.close(SaveOptions.DONOTSAVECHANGES); }
        } catch (closeWorkError) {}
        try {
            if (openedHere && doc !== null) { doc.close(SaveOptions.DONOTSAVECHANGES); }
        } catch (closeDocError) {}
        work = null;
        doc = null;
    }

    if (progress !== null) {
        pumpProgress("Finishing...", jobs.length);
        try { progress.close(); } catch (closeProgressError) {}
    }

    } finally {
        app.displayDialogs = savedDialogs;
        app.preferences.rulerUnits = savedUnits;
    }

    // ================= Report =================

    var lines = [];
    lines.push("PNG Export Log");
    lines.push("Source: " + (useOpenFiles ? "Open Files" : sourceFolder.fsName));
    lines.push("Destination: " + (saveSame ? "Same Location As Source" : destFolder.fsName));
    if (!saveSame && keepTree) {
        lines.push("Structure Measured From: " + (treeRoot !== "" ? treeRoot : "No Common Folder, Saved Flat"));
    }
    lines.push("PNG Method: " + pngMethod +
               (pngMethod === "quick" ? " (Compression " + compression + ")" : "") +
               (interlaced ? " + Interlaced" : ""));
    if (profilesEmbedded === converted && converted > 0) {
        lines.push("Color Profile: Embedded and Verified In All " + converted + " File(s)");
    } else if (profilesEmbedded > 0) {
        lines.push("Color Profile: Embedded In Only " + profilesEmbedded + " Of " + converted + " File(s)");
    } else {
        lines.push("Color Profile: None. Photoshop Does Not Write An ICC Profile");
        lines.push("               Into A PNG, By Script or By Hand. Output Is");
        lines.push("               Untagged and Will Be Read As sRGB.");
    }
    if (usedFallback) {
        lines.push("WARNING: Action Manager Save Failed on At Least One File;");
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
            // On macOS Collapses "\r\n" To A Bare CR and Leaves The Log As One
            // Unreadable Line. Pin It To The Platform's Convention Instead.
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
