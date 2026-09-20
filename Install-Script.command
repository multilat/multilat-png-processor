#!/bin/bash
# Multilat PNG Processor Installer
# Double-click This File To Install The Script

echo "================================"
echo "Multilat PNG Processor Installer"
echo "================================"
echo ""

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SOURCE="$SCRIPT_DIR/Multilat-PNG-Processor.jsx"

if [ ! -f "$SOURCE" ]; then
    echo "ERROR: Multilat-PNG-Processor.jsx Not Found Beside This Installer."
    echo "Press Any Key To Exit..."
    read -n 1
    exit 1
fi

# Photoshop Only Lists Scripts From The APPLICATION Presets Folder. The
# User-Level Application Support Folder Is Never Scanned For Scripts.
FOUND=0
for PS_APP in /Applications/Adobe\ Photoshop\ */; do
    TARGET_DIR="${PS_APP}Presets/Scripts"
    [ -d "$TARGET_DIR" ] || continue

    VERSION=$(basename "$PS_APP")
    echo "Found: $VERSION"
    echo "Installing To: $TARGET_DIR"

    # The Presets Folder Is Root-Owned, So This Needs An Administrator Password
    sudo cp "$SOURCE" "$TARGET_DIR/Multilat-PNG-Processor.jsx"

    if [ $? -eq 0 ]; then
        sudo chmod 644 "$TARGET_DIR/Multilat-PNG-Processor.jsx"
        echo "Installed Successfully."
        FOUND=$((FOUND + 1))
    else
        echo "FAILED To Install For $VERSION"
    fi
    echo ""
done

if [ "$FOUND" -eq 0 ]; then
    echo "ERROR: No Photoshop Installation Was Found In /Applications."
    echo "Press Any Key To Exit..."
    read -n 1
    exit 1
fi

echo "================================"
echo "Installation Complete"
echo "================================"
echo ""
echo "To Use The Script:"
echo ""
echo "1. Quit Photoshop Completely (Cmd+Q)"
echo "2. Reopen Photoshop"
echo "3. Go To: File > Scripts > Multilat-PNG-Processor"
echo ""
echo "The Scripts Menu Is Only Read At Launch, So The Restart Matters."
echo ""
echo "Press Any Key To Exit..."
read -n 1
