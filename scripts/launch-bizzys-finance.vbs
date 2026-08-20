' Launch Bizzy's Finance (local Electron app) without a permanently open console window.
Option Explicit
Dim shell, fso, projectDir, npmCmd, logPath
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
logPath = projectDir & "\scripts\last-launch.log"

If Not fso.FolderExists(projectDir & "\node_modules") Then
  MsgBox "Dependencies are missing." & vbCrLf & vbCrLf & _
    "Open a terminal in:" & vbCrLf & projectDir & vbCrLf & vbCrLf & _
    "Run: npm install" & vbCrLf & "Then try this shortcut again.", _
    vbExclamation, "Bizzy's Finance"
  WScript.Quit 1
End If

shell.CurrentDirectory = projectDir
' 0 = hidden window; False = don't wait for exit
npmCmd = "cmd /c npm run electron:dev > """ & logPath & """ 2>&1"
shell.Run npmCmd, 0, False
