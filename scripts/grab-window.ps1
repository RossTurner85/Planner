# Captures a window by title into a PNG, DPI-aware so nothing gets clipped.
# Enumerates top-level windows rather than trusting MainWindowTitle, which points
# at DevTools whenever that happens to be open.
param([string]$Match = "*Bizzy*", [string]$Out = "$env:TEMP\app-window.png")

$code = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Drawing;
public class WinCap {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

  public static string Title(IntPtr h) {
    int len = GetWindowTextLength(h);
    if (len == 0) return "";
    var sb = new StringBuilder(len + 1);
    GetWindowText(h, sb, sb.Capacity);
    return sb.ToString();
  }

  /** Visible, non-minimised, big enough to be a real window. */
  public static List<IntPtr> Find(string needle) {
    var hits = new List<IntPtr>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      var t = Title(h);
      if (t.Length == 0) return true;
      if (t.IndexOf(needle, StringComparison.OrdinalIgnoreCase) < 0) return true;
      RECT r; GetWindowRect(h, out r);
      if (r.R - r.L < 200 || r.B - r.T < 200) return true;
      hits.Add(h);
      return true;
    }, IntPtr.Zero);
    return hits;
  }

  public static string Grab(IntPtr h, string path) {
    RECT r; GetWindowRect(h, out r);
    int w = r.R - r.L, ht = r.B - r.T;
    using (var bmp = new Bitmap(w, ht))
    using (var g = Graphics.FromImage(bmp)) {
      IntPtr hdc = g.GetHdc();
      PrintWindow(h, hdc, 2);
      g.ReleaseHdc(hdc);
      bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
    }
    return w + "x" + ht;
  }
}
'@

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing

[WinCap]::SetProcessDPIAware() | Out-Null

# The param keeps its glob-friendly default, but the search itself is a substring.
$needle = $Match.Trim('*')
$hits = [WinCap]::Find($needle)
if ($hits.Count -eq 0) {
  Write-Output "NO WINDOW FOUND for '$needle'"
  exit 1
}

$h = $hits[0]
$size = [WinCap]::Grab($h, $Out)
Write-Output "$Out :: $([WinCap]::Title($h)) :: $size"
