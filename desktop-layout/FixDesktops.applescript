-- One-click wrapper for fix-desktops.py. Build with:
--   osacompile -o "Fix Desktops.app" FixDesktops.applescript
-- then drag "Fix Desktops.app" to the Dock.
-- First run: approve the System Events prompt and add "Fix Desktops" under
-- System Settings > Privacy & Security > Accessibility.

on run
    set scriptPath to "/Users/joelloyd/Projects/MyProjects/scripts/desktop-layout/fix-desktops.py"
    try
        do shell script "/usr/bin/python3 " & quoted form of scriptPath
        display notification "Desktop layout applied" with title "Fix Desktops"
    on error errMsg
        display dialog "Fix Desktops failed:" & return & return & errMsg buttons {"OK"} default button 1 with icon stop
    end try
end run
