#!/bin/bash
# macOS Desktop & App Organizer
# This script launches apps and moves them to assigned desktops using keyboard shortcuts

echo "🖥️  macOS Desktop Organizer"
echo "=========================="
echo ""

# CONFIGURATION - Main Display (6 desktops)
DESKTOP_1_DISPLAY_1=(
    "Spotify"
)

DESKTOP_2_DISPLAY_1=(
    "Slack"
)

DESKTOP_3_DISPLAY_1=(
    "Google Chrome"  # Personal login - you'll need to log in manually
)

DESKTOP_4_DISPLAY_1=(
    "Microsoft Outlook"
)

DESKTOP_5_DISPLAY_1=(
    "Cursor"
)

DESKTOP_6_DISPLAY_1=(
    "NordVPN"
    "iTerm"
    "Activity Monitor"
)

# CONFIGURATION - Secondary Display (5 desktops)
DESKTOP_1_DISPLAY_2=(
    "Figma"
)

DESKTOP_2_DISPLAY_2=(
    "Google Chrome"  # Work login - you'll need to manage separate Chrome profiles
)

DESKTOP_3_DISPLAY_2=(
    "Visual Studio Code"
)

DESKTOP_4_DISPLAY_2=(
    "GitKraken"
)

DESKTOP_5_DISPLAY_2=()  # Empty desktop

# Function to launch app and move to desktop
launch_and_move() {
    local app_name=$1
    local desktop_num=$2
    
    echo "📱 Launching $app_name and moving to Desktop $desktop_num..."
    
    # Launch the app
    open -a "$app_name" 2>/dev/null
    
    if [ $? -ne 0 ]; then
        echo "   ⚠️  Warning: Could not find app '$app_name'"
        return
    fi
    
    sleep 1.5
    
    # Move to specified desktop using Control + Desktop Number
    osascript -e "tell application \"System Events\" to keystroke \"$desktop_num\" using control down" 2>/dev/null
    
    sleep 0.5
}

# Main execution
echo "This will launch and organize your apps across desktops."
echo "Make sure you have:"
echo "  ✓ Created 6 desktops on your main display"
echo "  ✓ Created 5 desktops on your secondary display"
echo "  ✓ Enabled keyboard shortcuts: System Settings > Keyboard > Keyboard Shortcuts > Mission Control"
echo "  ✓ Enabled 'Switch to Desktop X' shortcuts (Control + 1, 2, 3, etc.)"
echo ""
echo "⚠️  IMPORTANT NOTES:"
echo "  • Google Chrome will need separate profiles for personal/work logins"
echo "  • Create Chrome profiles: Chrome Menu > Profiles > Add"
echo "  • You may need to manually move the second Chrome instance to the secondary display"
echo ""
read -p "Press Enter to continue..."
echo ""

# Process Main Display
echo "🖥️  Setting up Main Display..."
echo ""

echo "📂 Desktop 1 - Spotify"
for app in "${DESKTOP_1_DISPLAY_1[@]}"; do
    launch_and_move "$app" "1"
done

echo "📂 Desktop 2 - Slack"
for app in "${DESKTOP_2_DISPLAY_1[@]}"; do
    launch_and_move "$app" "2"
done

echo "📂 Desktop 3 - Google Chrome (Personal)"
for app in "${DESKTOP_3_DISPLAY_1[@]}"; do
    launch_and_move "$app" "3"
done

echo "📂 Desktop 4 - Microsoft Outlook"
for app in "${DESKTOP_4_DISPLAY_1[@]}"; do
    launch_and_move "$app" "4"
done

echo "📂 Desktop 5 - Cursor"
for app in "${DESKTOP_5_DISPLAY_1[@]}"; do
    launch_and_move "$app" "5"
done

echo "📂 Desktop 6 - NordVPN, iTerm, Activity Monitor"
for app in "${DESKTOP_6_DISPLAY_1[@]}"; do
    launch_and_move "$app" "6"
done

# Secondary Display Setup
echo ""
echo "🖥️  Now setting up Secondary Display..."
echo "   Please move your mouse to the secondary display"
read -p "   Press Enter when ready..."
echo ""

echo "📂 Desktop 1 (Secondary) - Figma"
for app in "${DESKTOP_1_DISPLAY_2[@]}"; do
    launch_and_move "$app" "1"
done

echo "📂 Desktop 2 (Secondary) - Google Chrome (Work)"
echo "   ⚠️  Note: You may need to manually open a new Chrome window with your work profile"
for app in "${DESKTOP_2_DISPLAY_2[@]}"; do
    launch_and_move "$app" "2"
done

echo "📂 Desktop 3 (Secondary) - Visual Studio Code"
for app in "${DESKTOP_3_DISPLAY_2[@]}"; do
    launch_and_move "$app" "3"
done

echo "📂 Desktop 4 (Secondary) - GitKraken"
for app in "${DESKTOP_4_DISPLAY_2[@]}"; do
    launch_and_move "$app" "4"
done

if [ ${#DESKTOP_5_DISPLAY_2[@]} -gt 0 ]; then
    echo "📂 Desktop 5 (Secondary) - Empty"
    for app in "${DESKTOP_5_DISPLAY_2[@]}"; do
        launch_and_move "$app" "5"
    done
fi

echo ""
echo "✅ Desktop organization complete!"
echo ""
echo "💡 Pro Tips:"
echo "   • To make assignments permanent: Right-click app in Dock > Options > Assign To: This Desktop"
echo "   • System Settings > Desktop & Dock > Uncheck 'Automatically rearrange Spaces'"
echo "   • For separate Chrome windows, create profiles and launch with: open -na 'Google Chrome' --args --profile-directory='Profile 2'"
echo ""
echo "📝 To run at startup:"
echo "   1. Save this script somewhere (e.g., ~/Scripts/organize-desktops.sh)"
echo "   2. chmod +x ~/Scripts/organize-desktops.sh"
echo "   3. System Settings > General > Login Items > Click + > Select the script"
echo ""
echo "🌐 Managing Multiple Chrome Instances:"
echo "   1. Chrome Menu > Profiles > Add new profile"
echo "   2. Name one 'Personal' and one 'Work'"
echo "   3. Launch specific profile: open -na 'Google Chrome' --args --profile-directory='Default'"