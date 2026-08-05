-- One-click wrapper for fix-desktops.py. Build with:
--   osacompile -o "Fix Desktops.app" FixDesktops.applescript
-- then drag "Fix Desktops.app" to the Dock.
-- First run: approve the System Events prompt and add "Fix Desktops" under
-- System Settings > Privacy & Security > Accessibility.

on run
    set scriptPath to "/Users/joelloyd/Projects/MyProjects/scripts/desktop-layout/fix-desktops.py"
    try
        do shell script "/usr/bin/python3 " & quoted form of scriptPath & " --relaunch"
        display notification "Desktop layout applied, apps moved" with title "Fix Desktops"
    on error errMsg
        if errMsg contains "assistive access" then
            set answer to button returned of (display dialog "Fix Desktops needs Accessibility permission to manage desktops." & return & return & "Enable \"Fix Desktops\" in the list (add it with + if missing), then click the Dock icon again." buttons {"Cancel", "Open Settings"} default button "Open Settings" with icon caution)
            if answer is "Open Settings" then
                do shell script "open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'"
            end if
        else
            display dialog "Fix Desktops failed:" & return & return & errMsg buttons {"OK"} default button 1 with icon stop
        end if
    end try
end run
